// server.js  - 20251027_130400

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// 정적 파일 서빙 설정 (public 폴더)
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'client.html'));
});

// **********************************
// 메시지, 사용자 상태를 저장할 임시 저장소
const users = {}; // { socketId: { id: 'user_id', type: 'counselor/client', room: 'counselorId_clientId', socketId: '...' } }
const rooms = {}; // { roomName: [{ sender: 'id', message: 'text', timestamp: Date, read: boolean, roomName: '...' }] }
const counselorId = 'counselor123'; // 고정된 상담사 ID

// **********************************

io.on('connection', (socket) => {
  console.log('새로운 사용자 연결됨:', socket.id);

  // 1. 사용자 로그인 (상담사 또는 내담자)
  socket.on('login', ({ userId, userType }) => {
    // 간단한 익명 처리: 내담자 ID가 없으면 'client_' + 랜덤 ID 부여
    const finalUserId = userType === 'client' && !userId ? `client_${Math.random().toString(36).substring(2, 9)}` : userId;

    // 사용자 정보 저장
    users[socket.id] = { id: finalUserId, type: userType, socketId: socket.id };

    // 내담자는 상담사 방에, 상담사는 자신의 방에 조인
    if (userType === 'client') {
      const roomName = `${counselorId}_${finalUserId}`;
      users[socket.id].room = roomName;
      socket.join(roomName);

      // 방이 없으면 생성
      if (!rooms[roomName]) {
        rooms[roomName] = [];
      }
      
      console.log(`내담자 ${finalUserId} (방: ${roomName}) 접속`);

      // 상담사에게 새로운 내담자 접속 알림
      io.emit('client_list_update', getClientList());

      // 접속한 내담자에게 기존 대화 내용 전송 (메시지 객체에 roomName 추가)
      const messagesWithRoom = rooms[roomName].map(msg => ({ ...msg, roomName: roomName }));
      socket.emit('load_messages', messagesWithRoom);

    } else if (userType === 'counselor') {
      users[socket.id].id = counselorId; // 상담사 ID 고정
      users[socket.id].room = null; // 상담사는 특정 방에 종속되지 않음

      // 접속한 상담사에게 전체 내담자 목록 전송
      socket.emit('client_list_update', getClientList());
      
      console.log(`상담사 ${counselorId} 접속`);
    }

    socket.emit('login_success', users[socket.id]);
  });
  
  // 2. 메시지 수신
  socket.on('send_message', (data) => {
    const user = users[socket.id];
    if (!user || (!user.room && user.type !== 'counselor')) {
        console.warn('사용자 정보 또는 채팅방 정보 없음.');
        return;
    }
    
    // 상담사의 경우, 채팅방을 선택해야 user.room이 설정됨
    const roomName = user.type === 'counselor' ? data.targetRoom : user.room;
    
    if (!roomName || !rooms[roomName]) {
        console.warn(`유효하지 않은 채팅방: ${roomName}`);
        return;
    }

    const message = {
        sender: user.id,
        message: data.message,
        timestamp: new Date().toISOString(),
        read: false, // 초기에는 안 읽음 상태
        roomName: roomName // 클라이언트가 메시지를 올바르게 필터링하도록 roomName 추가
    };

    // 메시지 저장소에 추가
    rooms[roomName].push(message);

    // 해당 방(room)에 메시지 전송
    io.to(roomName).emit('receive_message', message);
    
    // 상담사에게 알림 업데이트 (읽지 않은 메시지 카운트)
    io.emit('client_list_update', getClientList());
  });
  
  // 3. 채팅방 선택 (상담사 전용)
  socket.on('select_chat_room', (roomName) => {
    const user = users[socket.id];
    if (user && user.type === 'counselor') {
      // 새 방에 조인
      user.room = roomName; 
      // socket.join(roomName); // 이미 내담자가 접속 시 조인했으므로, 여기서는 불필요하지만 안정성을 위해 유지 가능
      
      // 해당 방의 메시지 모두 '읽음'으로 처리
      if (rooms[roomName]) {
        rooms[roomName].forEach(msg => {
          if (msg.sender !== user.id) { // 내가 아닌 상대방이 보낸 메시지만 읽음 처리
            msg.read = true;
          }
        });
        
        // 내담자에게도 읽음 상태 업데이트 전송
        const clientId = roomName.replace(`${counselorId}_`, '');
        const clientSocket = Object.values(users).find(u => u.id === clientId && u.type === 'client');
        if (clientSocket) {
             io.to(clientSocket.socketId).emit('messages_read');
        }
        
        // 상담사에게 읽음 처리된 메시지 및 목록 업데이트
        const messagesWithRoom = rooms[roomName].map(msg => ({ ...msg, roomName: roomName }));
        socket.emit('load_messages', messagesWithRoom);
        io.emit('client_list_update', getClientList());
      }
    }
  });
  
  // 4. 상담 종료 (로그아웃)
  socket.on('end_counseling', () => {
    const user = users[socket.id];
    if (user && user.type === 'client') {
      console.log(`내담자 ${user.id} 상담 종료 및 연결 해제`);
      // 해당 내담자의 방 기록은 남겨두고, 사용자만 해제
      delete users[socket.id]; 
      
      // 상담사에게 목록 업데이트 알림 (내담자 접속 상태 변경)
      io.emit('client_list_update', getClientList());

    } else if (user && user.type === 'counselor') {
      // 상담사 로그아웃
      console.log(`상담사 ${user.id} 로그아웃 및 연결 해제`);
      delete users[socket.id]; 
    }
    socket.disconnect(); // 연결 해제
  });


  // 5. 연결 해제
  socket.on('disconnect', () => {
    const user = users[socket.id];
    if (user) {
      console.log('사용자 연결 해제됨:', user.id);
      
      // 내담자일 경우, 목록 업데이트 알림 (접속 상태 변경 반영)
      if (user.type === 'client') {
        io.emit('client_list_update', getClientList());
      }

      delete users[socket.id];
    } else {
       console.log('알 수 없는 사용자 연결 해제됨:', socket.id);
    }
  });
});

// **********************************
// 유틸리티 함수
// **********************************

// 내담자 목록과 읽지 않은 메시지 수를 계산하여 반환
function getClientList() {
    const clientRooms = Object.keys(rooms).filter(roomName => roomName.startsWith(counselorId));
    
    const clientList = clientRooms.map(roomName => {
        // roomName: counselorId_clientId
        const clientId = roomName.replace(`${counselorId}_`, '');
        const unreadCount = rooms[roomName].filter(msg => msg.sender !== counselorId && !msg.read).length;
        
        // 현재 접속 중인 내담자인지 확인
        const isOnline = Object.values(users).some(u => u.id === clientId && u.type === 'client');
        
        return {
            id: clientId,
            roomName: roomName,
            unreadCount: unreadCount,
            isOnline: isOnline
        };
    });
    
    return clientList;
}

// **********************************

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
  console.log('Ctrl+C 로 종료하세요.');
});