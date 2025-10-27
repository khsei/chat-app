// public/client.js

document.addEventListener('DOMContentLoaded', () => {
    
    const socket = io();

    // DOM 요소
    const loginScreen = document.getElementById('login-screen');
    const mainApp = document.getElementById('main-app');
    const userIdInput = document.getElementById('user-id');
    const userTypeSelect = document.getElementById('user-type');
    const loginButton = document.getElementById('login-btn'); 
    
    const clientListUl = document.getElementById('client-list');
    const messagesDiv = document.getElementById('messages');
    const messageInput = document.getElementById('message-input');
    const sendButton = document.getElementById('send-button'); 
    const currentChatNameSpan = document.getElementById('current-chat-name');
    const downloadBtn = document.getElementById('download-btn');
    const logoutBtn = document.getElementById('logout-btn');

    // 전역 상태
    let currentUser = null;
    let currentRoom = null; 
    let allMessages = {}; 

    // **********************************
    // UI/이벤트 핸들러
    // **********************************

    function login() {
        const userId = userIdInput.value.trim();
        const userType = userTypeSelect.value;
        
        if (userType === 'counselor' && userId !== 'counselor123') { 
            alert("상담사 ID는 'counselor123'이어야 합니다.");
            return;
        }
        socket.emit('login', { userId: userId, userType: userType });
    }

    function sendMessage() {
        const message = messageInput.value.trim();
        if (message.length === 0) return;
        if (currentUser.type === 'counselor' && !currentRoom) {
            alert("내담자를 선택하여 채팅방을 열어주세요.");
            return;
        }
        
        // 1. 서버로 메시지 전송
        socket.emit('send_message', { 
            message: message,
            targetRoom: currentRoom 
        });

        // 2. 상담사: 자신의 메시지 화면에 즉시 표시 로직 (정상 작동 확인됨)
        if (currentUser.type === 'counselor' && currentRoom) {
            const tempMessage = {
                sender: currentUser.id,
                message: message,
                timestamp: new Date().toISOString(), 
                roomName: currentRoom,
                read: false 
            };
            
            if (!allMessages[currentRoom]) allMessages[currentRoom] = [];
            allMessages[currentRoom].push(tempMessage);

            displayMessages(allMessages[currentRoom]);
            scrollToBottom();
        }

        messageInput.value = ''; 
        messageInput.focus();
    }

    if (messageInput) {
        messageInput.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault(); 
                sendMessage();
            } 
        });
    }

    if (sendButton) sendButton.addEventListener('click', sendMessage);
    if (loginButton) loginButton.addEventListener('click', login); 

    function selectChatRoom(roomName, clientName) {
        if (currentUser.type !== 'counselor') return;
        
        currentRoom = roomName;
        currentChatNameSpan.textContent = clientName;

        document.querySelectorAll('#client-list li').forEach(li => {
            li.classList.remove('selected');
            if (li.dataset.room === roomName) {
                li.classList.add('selected');
            }
        });

        // 서버에 채팅방 선택 알림 -> 서버에서 읽음 처리 및 메시지 로드 요청
        socket.emit('select_chat_room', roomName);

        downloadBtn.style.display = 'block'; 
        messageInput.disabled = false;
        messageInput.placeholder = '메시지를 입력하세요 (Ctrl+Enter 전송)';
        sendButton.disabled = false;
    }

    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            const confirmation = confirm(currentUser.type === 'client' ? 
                "상담을 종료하고 로그아웃하시겠습니까? (이전 대화는 유지됩니다)" : 
                "상담사 로그아웃을 하시겠습니까?"
            );

            if (confirmation) {
                socket.emit('end_counseling');
                mainApp.style.display = 'none';
                loginScreen.style.display = 'block';
                currentUser = null;
                currentRoom = null;
                allMessages = {};
                messagesDiv.innerHTML = '';
                clientListUl.innerHTML = '';
                currentChatNameSpan.textContent = '채팅방을 선택해주세요.';
            }
        });
    }

    if (downloadBtn) {
        downloadBtn.addEventListener('click', () => {
            if (currentUser.type !== 'counselor' || !currentRoom || !allMessages[currentRoom]) {
                alert("대화 내용을 다운로드할 채팅방을 선택해주세요.");
                return;
            }
            const messages = allMessages[currentRoom];
            const clientName = currentChatNameSpan.textContent;
            let textContent = `--- [${clientName}] 님과의 상담 내용 (${new Date().toLocaleString()}) ---\n\n`;

            messages.forEach(msg => {
                const date = new Date(msg.timestamp);
                const time = date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
                textContent += `[${msg.sender} - ${time}] ${msg.message}\n`;
            });

            const blob = new Blob([textContent], { type: 'text/plain;charset=utf-8' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `상담기록_${clientName}_${new Date().toISOString().substring(0, 10)}.txt`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        });
    }

    // **********************************
    // Socket.io 리스너
    // **********************************

    socket.on('login_success', (userData) => {
        currentUser = userData;
        loginScreen.style.display = 'none';
        mainApp.style.display = 'flex';
        
        if (currentUser.type === 'client') {
            currentRoom = currentUser.room;
            currentChatNameSpan.textContent = `상담사님과 대화 (${currentUser.id})`;
            clientListUl.style.display = 'none'; 
            downloadBtn.style.display = 'none';
            logoutBtn.textContent = '상담 종료';
        } else {
            messageInput.disabled = true;
            sendButton.disabled = true;
            messageInput.placeholder = '내담자를 선택해주세요.';
            logoutBtn.textContent = '로그아웃';
        }
    });

    socket.on('client_list_update', (clientList) => {
        if (currentUser && currentUser.type === 'counselor') {
            updateClientList(clientList);
        } 
    });

    function updateClientList(clientList) {
        clientListUl.innerHTML = '';
        
        clientList.forEach(client => {
            const li = document.createElement('li');
            const clientName = client.id.startsWith('client_') ? '익명 내담자' : client.id;
            li.textContent = clientName;
            li.dataset.room = client.roomName;

            if (client.roomName === currentRoom) {
                li.classList.add('selected');
            }

            if (client.unreadCount > 0) {
                const span = document.createElement('span');
                span.className = 'unread-count';
                span.textContent = client.unreadCount;
                li.appendChild(span);
            }
            
            const statusDot = document.createElement('span');
            statusDot.className = client.isOnline ? 'status-dot online' : 'status-dot offline';
            statusDot.title = client.isOnline ? '접속 중' : '상담 종료/부재';
            li.appendChild(statusDot);

            li.onclick = () => selectChatRoom(client.roomName, clientName);
            clientListUl.appendChild(li);
        });
    }

    // 3. 메시지 수신 (및 전송 직후) - ⚠️ 내담자 메시지 실시간 표시 로직
    socket.on('receive_message', (message) => {
        
        const targetRoom = getRoomNameFromMessage(message);
        
        if (!allMessages[targetRoom]) allMessages[targetRoom] = [];
        
        // 중복 방지 로직
        const isDuplicate = allMessages[targetRoom].some(
            m => m.timestamp === message.timestamp && m.sender === message.sender && m.message === message.message
        );
        
        if (!isDuplicate) { 
             allMessages[targetRoom].push(message);
        } 
        
        // [수정된 로직] 상담사가 현재 이 방을 보고 있다면 즉시 표시
        const shouldDisplay = (currentUser.type === 'client') || 
                              (currentUser.type === 'counselor' && currentRoom === targetRoom);

        if (shouldDisplay) 
        {
            displayMessages(allMessages[targetRoom]);
            scrollToBottom();
            
            // 현재 보고 있는 방이므로 서버에 읽음 요청
            if (currentUser.type === 'counselor' && currentRoom === targetRoom) {
                 socket.emit('mark_as_read', { roomName: targetRoom, readerId: currentUser.id }); 
            }
        } 
    });

    socket.on('load_messages', (messages) => {
        if (messages.length > 0) {
            const roomName = getRoomNameFromMessage(messages[0]);
            allMessages[roomName] = messages;
            displayMessages(messages);
        } else {
            allMessages[currentRoom] = []; 
            messagesDiv.innerHTML = '<p style="text-align:center; color:#777;">아직 대화가 없습니다. 메시지를 보내보세요.</p>';
        }
        scrollToBottom();
    });

    socket.on('messages_read', () => {
        if (currentUser.type === 'client' && currentRoom && allMessages[currentRoom]) {
            allMessages[currentRoom].forEach(msg => {
                if (msg.sender === currentUser.id) {
                    msg.read = true;
                }
            });
            displayMessages(allMessages[currentRoom]);
        }
    });


    // **********************************
    // UI 헬퍼 함수
    // **********************************

    function displayMessages(messages) {
        if (!messages || messages.length === 0) {
             messagesDiv.innerHTML = '<p style="text-align:center; color:#777;">아직 대화가 없습니다. 메시지를 보내보세요.</p>';
             return;
        }
        
        messagesDiv.innerHTML = '';
        let lastDate = null;

        messages.forEach(msg => {
            const date = new Date(msg.timestamp);
            const messageDate = date.toLocaleDateString('ko-KR');
            
            if (lastDate !== messageDate) {
                lastDate = messageDate;
                const divider = document.createElement('div');
                divider.className = 'date-divider';
                const dayOfWeek = date.toLocaleDateString('ko-KR', { weekday: 'long' });
                divider.innerHTML = `<span>${messageDate} (${dayOfWeek})</span>`;
                messagesDiv.appendChild(divider);
            }

            const item = document.createElement('div');
            item.className = 'message-item ' + (msg.sender === currentUser.id ? 'sent' : 'received');

            const content = document.createElement('div');
            content.className = 'message-content';
            content.textContent = msg.message; 

            const info = document.createElement('div');
            info.className = 'message-info';
            
            const timeSpan = document.createElement('span');
            timeSpan.textContent = date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
            
            const readStatusSpan = document.createElement('span');
            readStatusSpan.className = 'read-status';
            
            if (msg.sender === currentUser.id) {
                readStatusSpan.textContent = msg.read ? '읽음' : '1'; 
            }
            
            info.appendChild(readStatusSpan);
            info.appendChild(timeSpan);

            if (msg.sender === currentUser.id) {
                item.appendChild(info);
                item.appendChild(content);
            } else {
                item.appendChild(content);
                item.appendChild(info);
            }

            messagesDiv.appendChild(item);
        });
        
        scrollToBottom();
    }

    function scrollToBottom() {
        if (messagesDiv) {
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
        }
    }

    // 서버가 메시지 객체에 roomName을 포함하고 있다고 가정합니다.
    function getRoomNameFromMessage(message) {
        return message.roomName || currentUser.room || currentRoom;
    }
});