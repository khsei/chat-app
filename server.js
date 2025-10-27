// server.js

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const mongoose = require('mongoose'); // Mongoose 추가

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// **********************************
// MongoDB 연결 설정
// **********************************
const DB_URI = 'mongodb://localhost:27017/counseling_chat'; // 로컬 MongoDB 연결 문자열

mongoose.connect(DB_URI)
.then(() => console.log('MongoDB 연결 성공'))
.catch(err => console.error('MongoDB 연결 오류:', err));

// **********************************
// 메시지 모델 정의 (Schema)
// **********************************
const MessageSchema = new mongoose.Schema({
    roomName: String,   // 채팅방 ID (counselorId_clientId)
    sender: String,     // 보낸 사람 ID
    message: String,    // 메시지 내용
    timestamp: { type: Date, default: Date.now }, // 전송 시간
    read: { type: Boolean, default: false }      // 읽음 상태
});

const Message = mongoose.model('Message', MessageSchema);

// **********************************
// 서버 설정 및 임시 저장소 (접속 상태 및 카운트용)
// **********************************
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'client.html'));
});

const users = {}; 
// rooms 객체는 DB 연동 후, 현재 접속 중인 사용자의 읽지 않은 메시지 카운트를 관리하는 용도로 임시 사용합니다.
const rooms = {}; 
const counselorId = 'counselor123'; 

// **********************************

io.on('connection', (socket) => {
  console.log('새로운 사용자 연결됨:', socket.id);

  // 1. 사용자 로그인 (상담사 또는 내담자)
  socket.on('login', async ({ userId, userType }) => { // async 추가
    // ... (이전 코드 유지)
    const finalUserId = userType === 'client' && !userId ? `client_${Math.random().toString(36).substring(2, 9)}` : userId;

    users[socket.id] = { id: finalUserId, type: userType, socketId: socket.id };

    if (userType === 'client') {
      const roomName = `${counselorId}_${finalUserId}`;
      users[socket.id].room = roomName;
      socket.join(roomName);

      // DB에서 기존 대화 내용 조회
      const existingMessages = await Message.find({ roomName: roomName })
                                            .sort('timestamp')
                                            .exec();
      
      // rooms 객체 업데이트 (client_list_update 카운트용)
      if (!rooms[roomName]) rooms[roomName] = [];
      rooms[roomName] = existingMessages.map(msg => ({ ...msg._doc, roomName: roomName, timestamp: msg.timestamp.toISOString() }));
      
      const messagesWithRoom = rooms[roomName].map(msg => ({ ...msg, roomName: roomName }));
      socket.emit('load_messages', messagesWithRoom);

      io.emit('client_list_update', getClientList());
      
    } else if (userType === 'counselor') {
      // ... (이전 코드 유지)
      users[socket.id].id = counselorId; 
      users[socket.id].room = null; 
      socket.emit('client_list_update', getClientList());
    }

    socket.emit('login_success', users[socket.id]);
  });
  
  // 2. 메시지 수신
  socket.on('send_message', async (data) => { // async 추가
    const user = users[socket.id];
    if (!user || (!user.room && user.type !== 'counselor')) return;

    const roomName = user.type === 'counselor' ? data.targetRoom : user.room;
    
    if (!roomName) return;

    const messageData = {
        roomName: roomName,
        sender: user.id,
        message: data.message,
        timestamp: new Date(),
        read: false
    };

    // MongoDB에 메시지 저장
    const newMessage = new Message(messageData);
    await newMessage.save();

    // 클라이언트에게 전송할 객체 (DB 저장된 시간과 roomName 포함)
    const message = {
        sender: user.id,
        message: data.message,
        timestamp: newMessage.timestamp.toISOString(),
        read: false,
        roomName: roomName 
    };

    // rooms 객체 업데이트 (읽지 않은 메시지 카운트용)
    if (!rooms[roomName]) rooms[roomName] = [];
    rooms[roomName].push(message); 
    
    io.to(roomName).emit('receive_message', message);
    io.emit('client_list_update', getClientList());
  });
  
  // 3. 채팅방 선택 (상담사 전용)
  socket.on('select_chat_room', async (roomName) => { // async 추가
    const user = users[socket.id];
    if (user && user.type === 'counselor') {
        user.room = roomName; 
        
        // DB에서 해당 방의 읽지 않은 메시지를 '읽음'으로 처리
        await Message.updateMany(
            { roomName: roomName, sender: { $ne: user.id }, read: false },
            { $set: { read: true } }
        );

        // DB에서 전체 메시지 조회
        const existingMessages = await Message.find({ roomName: roomName })
                                              .sort('timestamp')
                                              .exec();
        
        // rooms 객체 업데이트 (client_list_update 카운트용)
        if (!rooms[roomName]) rooms[roomName] = [];
        rooms[roomName] = existingMessages.map(msg => ({ 
            ...msg._doc, 
            roomName: roomName,
            timestamp: msg.timestamp.toISOString() // 클라이언트 전송을 위해 ISOString 변환
        }));
        
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
  });
  
  // 4. 상담 종료 (로그아웃)
  socket.on('end_counseling', () => {
    // ... (이전 코드 유지)
    const user = users[socket.id];
    if (user) {
        if (user.type === 'client') {
            delete users[socket.id]; 
            io.emit('client_list_update', getClientList());
        } else if (user.type === 'counselor') {
            delete users[socket.id]; 
        }
        socket.disconnect(); 
    }
  });


  // 5. 연결 해제
  socket.on('disconnect', () => {
    // ... (이전 코드 유지)
    const user = users[socket.id];
    if (user) {
        if (user.type === 'client') {
            io.emit('client_list_update', getClientList());
        }
        delete users[socket.id];
    }
  });
});

// **********************************
// 유틸리티 함수
// **********************************

// 내담자 목록과 읽지 않은 메시지 수를 계산하여 반환 (rooms 객체 기반)
function getClientList() {
    // rooms 객체를 사용하여 읽지 않은 메시지 수와 접속 상태를 계산합니다.
    const clientRooms = Object.keys(rooms).filter(roomName => roomName.startsWith(counselorId));
    
    const clientList = clientRooms.map(roomName => {
        const clientId = roomName.replace(`${counselorId}_`, '');
        // DB에 업데이트된 내용을 반영하기 위해 rooms 객체를 사용 (select_chat_room에서 업데이트됨)
        const unreadCount = rooms[roomName].filter(msg => msg.sender !== counselorId && !msg.read).length; 
        
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