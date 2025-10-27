// public/client.js - 20251027_130300

const socket = io();

// DOM 요소
const loginScreen = document.getElementById('login-screen');
const mainApp = document.getElementById('main-app');
const userIdInput = document.getElementById('user-id');
const userTypeSelect = document.getElementById('user-type');
const clientListUl = document.getElementById('client-list');
const messagesDiv = document.getElementById('messages');
const messageInput = document.getElementById('message-input');
const sendButton = document.getElementById('send-button');
const currentChatNameSpan = document.getElementById('current-chat-name');
const downloadBtn = document.getElementById('download-btn');
const logoutBtn = document.getElementById('logout-btn');

// 전역 상태
let currentUser = null;
let currentRoom = null; // 현재 선택된 채팅방 (상담사는 선택, 내담자는 로그인 시 자동 설정)
let allMessages = {}; // { roomName: [{...}] } 모든 메시지 데이터

// **********************************
// UI/이벤트 핸들러
// **********************************

// 접속 (로그인)
function login() {
    const userId = userIdInput.value.trim();
    const userType = userTypeSelect.value;
    
    socket.emit('login', { userId: userId, userType: userType });
}

// 메시지 전송
function sendMessage() {
    const message = messageInput.value.trim();
    
    if (message.length === 0) return;
    
    if (currentUser.type === 'counselor' && !currentRoom) {
        alert("내담자를 선택하여 채팅방을 열어주세요.");
        return;
    }
    
    // 서버로 메시지 전송
    socket.emit('send_message', { 
        message: message,
        // 상담사일 경우, 현재 선택된 방을 targetRoom으로 명시
        targetRoom: currentUser.type === 'counselor' ? currentRoom : currentUser.room
    });

    messageInput.value = ''; // 입력창 비우기
    messageInput.focus();
}

// Ctrl+Enter 처리
messageInput.addEventListener('keydown', (e) => {
    // Ctrl 키 또는 Cmd 키(Mac)가 눌려있고, Enter 키가 눌렸을 때
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault(); // 줄바꿈 방지
        sendMessage();
    } 
});

sendButton.addEventListener('click', sendMessage);

// 내담자 목록 항목 클릭 (상담사 전용)
function selectChatRoom(roomName, clientId) {
    if (currentUser.type !== 'counselor') return;
    
    currentRoom = roomName;
    const clientName = clientId.startsWith('client_') ? '익명 내담자' : clientId;
    currentChatNameSpan.textContent = clientId; // 화면 상단에는 ID 표시

    // 선택된 내담자 UI 업데이트
    document.querySelectorAll('#client-list li').forEach(li => {
        li.classList.remove('selected');
        if (li.dataset.room === roomName) {
            li.classList.add('selected');
        }
    });

    // 서버에 채팅방 선택 알림 -> 서버에서 읽음 처리 및 메시지 로드
    socket.emit('select_chat_room', roomName);

    // 대화 다운로드 버튼 표시
    downloadBtn.style.display = 'block'; 
    
    // 메시지 입력창 활성화
    messageInput.disabled = false;
    messageInput.placeholder = '메시지를 입력하세요 (Ctrl+Enter 전송)';
    sendButton.disabled = false;
}

// 상담 종료/로그아웃
logoutBtn.addEventListener('click', () => {
    const confirmation = confirm(currentUser.type === 'client' ? 
        "상담을 종료하고 로그아웃하시겠습니까? (이전 대화는 유지됩니다)" : 
        "상담사 로그아웃을 하시겠습니까?"
    );

    if (confirmation) {
        socket.emit('end_counseling');
        // UI 초기화
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

// 대화 다운로드 (상담사 전용)
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

    // 텍스트 파일 생성 및 다운로드
    const blob = new Blob([textContent], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `상담기록_${clientName}_${new Date().toISOString().substring(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
});


// **********************************
// Socket.io 리스너
// **********************************

// 1. 로그인 성공
socket.on('login_success', (userData) => {
    currentUser = userData;
    loginScreen.style.display = 'none';
    mainApp.style.display = 'flex';
    
    if (currentUser.type === 'client') {
        currentRoom = currentUser.room; // 내담자의 채팅방 설정 (문제 해결 핵심)
        currentChatNameSpan.textContent = `상담사님과 대화 (${currentUser.id})`;
        clientListUl.style.display = 'none'; // 내담자는 목록 숨김
        downloadBtn.style.display = 'none';
        logoutBtn.textContent = '상담 종료';
        
        // 내담자 모드에서는 입력창 활성화 (문제 해결 핵심)
        messageInput.disabled = false;
        sendButton.disabled = false;
        messageInput.placeholder = '메시지를 입력하세요 (Ctrl+Enter 전송)';
        
    } else {
        // 상담사는 초기에는 채팅방 선택 전이므로 입력 비활성화
        messageInput.disabled = true;
        sendButton.disabled = true;
        messageInput.placeholder = '내담자를 선택해주세요.';
        logoutBtn.textContent = '로그아웃';
        
        // 다운로드 버튼 숨김 (채팅방 선택 후 활성화)
        downloadBtn.style.display = 'none';
    }
    console.log('로그인 성공:', currentUser);
});

// 2. 내담자 목록 업데이트 (상담사 전용)
socket.on('client_list_update', (clientList) => {
    if (currentUser && currentUser.type === 'counselor') {
        updateClientList(clientList);
    }
});

function updateClientList(clientList) {
    clientListUl.innerHTML = '';
    
    clientList.forEach(client => {
        const li = document.createElement('li');
        const displayName = client.id.startsWith('client_') ? '익명 내담자' : client.id;
        li.textContent = displayName;
        li.dataset.room = client.roomName;
        li.dataset.clientId = client.id;

        if (client.roomName === currentRoom) {
            li.classList.add('selected');
        }

        // 알림 표시
        if (client.unreadCount > 0) {
            const span = document.createElement('span');
            span.className = 'unread-count';
            span.textContent = client.unreadCount;
            li.appendChild(span);
        }
        
        // 접속 상태 표시
        const statusDot = document.createElement('span');
        statusDot.className = client.isOnline ? 'status-dot online' : 'status-dot offline';
        statusDot.title = client.isOnline ? '접속 중' : '상담 종료/부재';
        li.appendChild(statusDot);

        li.onclick = () => selectChatRoom(client.roomName, client.id);
        clientListUl.appendChild(li);
    });
    
    // 현재 선택된 방이 있다면, 해당 방의 UI를 다시 업데이트 (알림 카운트 업데이트 반영)
    if (currentRoom && allMessages[currentRoom]) {
        // 메시지 표시 로직을 다시 호출할 필요는 없고, 목록만 업데이트되면 됨.
        // 하지만 혹시 모를 경우를 대비해, 메시지 데이터가 업데이트되었다면 다시 그려야 함.
        // 여기서는 목록만 업데이트하고, 메시지 데이터는 서버의 load_messages를 통해 받도록 합니다.
    }
}

// 3. 메시지 수신 (및 전송 직후)
socket.on('receive_message', (message) => {
    // 메시지 객체에 roomName이 있으므로, 정확히 비교 가능
    const messageRoomName = message.roomName; 
    
    // 현재 접속 중인 채팅방의 메시지인 경우에만 화면에 표시
    if (messageRoomName === currentRoom) { 
        
        // 메시지 데이터 저장
        if (!allMessages[messageRoomName]) allMessages[messageRoomName] = [];
        
        // 중복 방지
        if (!allMessages[messageRoomName].some(m => m.timestamp === message.timestamp && m.sender === message.sender)) {
             allMessages[messageRoomName].push(message);
        }

        displayMessages(allMessages[messageRoomName]);
        scrollToBottom();
    }
    // 상담사의 경우, 다른 방 메시지가 오면 client_list_update 이벤트로 알림이 업데이트됨.
});

// 4. 기존 메시지 로드 (채팅방 선택/내담자 로그인 시)
socket.on('load_messages', (messages) => {
    if (messages.length > 0) {
        const roomName = messages[0].roomName;
        allMessages[roomName] = messages;
        displayMessages(messages);
    } else if (currentRoom) {
         // 현재 방이 설정되어 있고, 받은 메시지가 없다면 빈 배열로 초기화
         allMessages[currentRoom] = []; 
         messagesDiv.innerHTML = '<p style="text-align:center; color:#777;">아직 대화가 없습니다. 메시지를 보내보세요.</p>';
    }
    scrollToBottom();
});

// 5. 메시지 읽음 처리 (내담자 전용)
socket.on('messages_read', () => {
    if (currentUser.type === 'client' && currentRoom && allMessages[currentRoom]) {
        // 내가 보낸 메시지의 'read' 상태를 true로 업데이트
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

// 메시지를 HTML로 변환하여 표시
function displayMessages(messages) {
    if (!messages || messages.length === 0) {
        messagesDiv.innerHTML = '<p style="text-align:center; color:#777;">아직 대화가 없습니다. 메시지를 보내보세요.</p>';
        return;
    }
    
    messagesDiv.innerHTML = '';
    let lastDate = null;

    messages.forEach(msg => {
        const date = new Date(msg.timestamp);
        // yyyy. MM. dd 형식
        const messageDate = date.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
        
        // 날짜 구분선 추가
        if (lastDate !== messageDate) {
            lastDate = messageDate;
            const divider = document.createElement('div');
            divider.className = 'date-divider';
            const dayOfWeek = date.toLocaleDateString('ko-KR', { weekday: 'short' }); // 요일 표시
            divider.innerHTML = `<span>${messageDate} (${dayOfWeek})</span>`;
            messagesDiv.appendChild(divider);
        }

        const item = document.createElement('div');
        item.className = 'message-item ' + (msg.sender === currentUser.id ? 'sent' : 'received');

        const content = document.createElement('div');
        content.className = 'message-content';
        content.textContent = msg.message; // pre-wrap 스타일로 여러 줄 표시

        const info = document.createElement('div');
        info.className = 'message-info';
        
        const timeSpan = document.createElement('span');
        timeSpan.textContent = date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
        
        const readStatusSpan = document.createElement('span');
        readStatusSpan.className = 'read-status';
        
        // 읽음 상태 표시
        if (msg.sender === currentUser.id) {
            // 내가 보낸 메시지인 경우에만 상대방의 읽음 상태 표시 (카톡처럼 '1' 또는 '읽음')
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
    
    // 모든 메시지를 표시한 후 다시 스크롤
    scrollToBottom();
}

// 스크롤 최하단으로
function scrollToBottom() {
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// 메시지 객체에서 roomName을 가져옵니다.
function getRoomNameFromMessage(message) {
    if (message.roomName) return message.roomName; 
    
    // 메시지 객체에 roomName이 없다면, 현재 활성화된 방을 사용
    return currentRoom; 
}