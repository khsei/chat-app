// public/client.js

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
let currentRoom = null; // 현재 선택된 채팅방 (상담사 전용)
let allMessages = {}; // { roomName: [{...}] } 모든 메시지 데이터

// **********************************
// UI/이벤트 핸들러
// **********************************

// 접속 (로그인)
function login() {
    const userId = userIdInput.value.trim();
    const userType = userTypeSelect.value;
    
    // 상담사 ID는 고정되지만, 테스트를 위해 입력받음
    if (userType === 'counselor' && userId !== 'counselor123') { 
        alert("상담사 ID는 'counselor123'이어야 합니다.");
        return;
    }

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
        targetRoom: currentRoom // 상담사일 경우 필요한 정보
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
    // Enter 키만 눌렸을 때 (줄바꿈 허용)
    // else if (e.key === 'Enter') {
    //     // 이 부분은 기본 동작인 줄바꿈을 허용합니다.
    // }
});

sendButton.addEventListener('click', sendMessage);

// 내담자 목록 항목 클릭 (상담사 전용)
function selectChatRoom(roomName, clientName) {
    if (currentUser.type !== 'counselor') return;
    
    currentRoom = roomName;
    currentChatNameSpan.textContent = clientName;

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
        currentRoom = currentUser.room;
        currentChatNameSpan.textContent = `상담사님과 대화 (${currentUser.id})`;
        clientListUl.style.display = 'none'; // 내담자는 목록 숨김
        downloadBtn.style.display = 'none';
        logoutBtn.textContent = '상담 종료';
    } else {
        // 상담사는 초기에는 채팅방 선택 전이므로 입력 비활성화
        messageInput.disabled = true;
        sendButton.disabled = true;
        messageInput.placeholder = '내담자를 선택해주세요.';
        logoutBtn.textContent = '로그아웃';
    }
    console.log('로그인 성공:', currentUser);
});

// 2. 내담자 목록 업데이트 (상담사 전용)
socket.on('client_list_update', (clientList) => {
    if (currentUser && currentUser.type === 'counselor') {
        updateClientList(clientList);
    } else if (currentUser && currentUser.type === 'client') {
        // 내담자에게는 상담사 접속 상태만 알릴 수 있지만, 이 예제에서는 목록 업데이트는 무시
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

        li.onclick = () => selectChatRoom(client.roomName, clientName);
        clientListUl.appendChild(li);
    });
    
    // 현재 선택된 방이 있다면, 해당 방의 UI를 다시 업데이트
    if (currentRoom && allMessages[currentRoom]) {
        displayMessages(allMessages[currentRoom]);
    }
}

// 3. 메시지 수신 (및 전송 직후)
socket.on('receive_message', (message) => {
    const roomName = currentUser.type === 'counselor' ? currentRoom : currentUser.room;
    
    // 현재 채팅방의 메시지인 경우에만 화면에 표시
    if (message.roomName === roomName || (currentUser.room === message.roomName && currentUser.type === 'client') || (currentUser.type === 'counselor' && currentRoom === getRoomNameFromMessage(message))) {
        
        // 메시지 데이터 저장 (만약 데이터가 서버에서 로드되지 않은 상태라면)
        const targetRoom = getRoomNameFromMessage(message);
        if (!allMessages[targetRoom]) allMessages[targetRoom] = [];
        
        // 중복 방지 (실제 구현에서는 메시지 ID로 관리)
        if (!allMessages[targetRoom].some(m => m.timestamp === message.timestamp && m.sender === message.sender)) {
             allMessages[targetRoom].push(message);
        }

        displayMessages(allMessages[roomName]);
        scrollToBottom();

        // 내담자: 메시지를 받으면 자동으로 읽음 처리 (선택적으로)
        // 상담사: 메시지를 받으면 목록이 업데이트되지만, 현재 채팅방에 있으면 곧바로 '읽음' 처리 요청을 보낼 수 있음
        if (currentUser.type === 'counselor' && currentRoom === getRoomNameFromMessage(message)) {
             // 채팅방에 있는 상태이므로, 서버에 읽음 요청을 다시 보낼 필요 없이, 다음 목록 업데이트에서 반영될 것임
        }

    } else if (currentUser.type === 'counselor') {
        // 현재 채팅방이 아닌 경우: 목록 업데이트는 서버에서 'client_list_update' 이벤트로 처리됨
    }
});

// 4. 기존 메시지 로드 (채팅방 선택/내담자 로그인 시)
socket.on('load_messages', (messages) => {
    if (messages.length > 0) {
        const roomName = getRoomNameFromMessage(messages[0]);
        allMessages[roomName] = messages;
        displayMessages(messages);
    } else {
         allMessages[currentRoom] = []; // 빈 배열로 초기화
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
    if (!messages || messages.length === 0) return;
    
    // 현재 방의 메시지만 필터링 (다시 한번 확인)
    const roomName = getRoomNameFromMessage(messages[0]);
    
    messagesDiv.innerHTML = '';
    let lastDate = null;

    messages.forEach(msg => {
        const date = new Date(msg.timestamp);
        const messageDate = date.toLocaleDateString('ko-KR');
        
        // 날짜 구분선 추가
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
        content.textContent = msg.message; // pre-wrap 스타일로 여러 줄 표시

        const info = document.createElement('div');
        info.className = 'message-info';
        
        const timeSpan = document.createElement('span');
        timeSpan.textContent = date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
        
        const readStatusSpan = document.createElement('span');
        readStatusSpan.className = 'read-status';
        
        // 읽음 상태 표시
        if (msg.sender === currentUser.id) {
            // 내가 보낸 메시지인 경우에만 상대방의 읽음 상태 표시
            readStatusSpan.textContent = msg.read ? '읽음' : '1'; // 카톡처럼 '1'로 표시
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

// 메시지 객체에서 roomName 추출 (서버에서 추가했다고 가정)
function getRoomNameFromMessage(message) {
    // 임시로, 메시지 로드 시 첫번째 메시지의 정보를 기반으로 RoomName을 만듭니다.
    // 실제로는 메시지 객체에 roomName 필드가 포함되어야 합니다.
    // 여기서는 간단하게 currentUser.room을 사용합니다.
    return currentUser.room || currentRoom;
}