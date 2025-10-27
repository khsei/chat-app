// server.js

const express = require('express');
const http = require('http');
const socketio = require('socket.io');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = socketio(server, {
    cors: {
        origin: "*", 
        methods: ["GET", "POST"]
    }
});

// MongoDB 연결 설정 (⚠️ YOUR_DB_URI를 실제 연결 문자열로 대체하세요!)
// [수정] serverSelectionTimeoutMS를 추가하여 연결 시 타임아웃 오류 방지 (IP 화이트리스트 오류를 대비한 코드적 안전장치)
const MONGO_URI = 'mongodb+srv://ddwee:ddwee8944@cluster0.rk0mf1y.mongodb.net/counseling_chat?appName=Cluster0';  

mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 15000 }) // 타임아웃 15초 설정
    .then(() => console.log('MongoDB 연결 성공'))
    .catch(err => console.error('MongoDB 연결 오류:', err));

// ----------------------------------------------------
// MongoDB 스키마 및 모델 정의
// ----------------------------------------------------

// 1. 메시지 스키마
const MessageSchema = new mongoose.Schema({
    sender: String,
    message: String,
    roomName: { type: String, required: true }, 
    timestamp: { type: Date, default: Date.now },
    read: { type: Boolean, default: false } 
});
const Message = mongoose.model('Message', MessageSchema);

// 2. 채팅방 스키마 (RoomName과 ClientId에 고유 인덱스가 있으므로 DuplicateKey 오류에 취약합니다)
const RoomSchema = new mongoose.Schema({
    roomName: { type: String, unique: true, required: true }, // [unique: true]
    clientId: { type: String, unique: true, required: true }, // [unique: true]
    counselorId: { type: String, default: 'counselor123' },
    isOnline: { type: Boolean, default: true }
});
const Room = mongoose.model('Room', RoomSchema);


// ----------------------------------------------------
// 전역 상태 관리
// ----------------------------------------------------

const connectedUsers = {}; 

// ----------------------------------------------------
// Express 설정
// ----------------------------------------------------

app.use(express.static('public')); 

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/client.html');
});


// ----------------------------------------------------
// Socket.IO 이벤트 핸들러
// ----------------------------------------------------

io.on('connection', (socket) => {
    console.log('새로운 사용자 연결됨:', socket.id);

    // 1. 로그인/접속
    socket.on('login', async ({ userId, userType }) => {
        let room;

        if (userType === 'client') {
            
            // 1-1. 내담자 ID 및 방 이름 결정
            const clientId = userId.length > 0 ? userId : `client_${socket.id.substring(0, 8)}`;
            const generatedRoomName = `room_${clientId}`; // [수정] roomName을 명시적으로 생성
            
            try {
                // 1-2. 채팅방 찾거나 생성 (findOneAndUpdate)
                room = await Room.findOneAndUpdate(
                    { clientId: clientId }, // 내담자 ID로 방을 찾는다.
                    { 
                        $set: { isOnline: true },
                        // [!!! 핵심 수정: 새로 생성될 경우 roomName을 확실하게 설정 !!!]
                        $setOnInsert: { roomName: generatedRoomName } 
                    }, 
                    { upsert: true, new: true } // 없으면 생성, 새 문서 반환
                );

                // 만약 room이 null이거나 roomName이 유효하지 않다면 오류 처리 (실제로는 upsert 때문에 발생 확률 낮음)
                if (!room || !room.roomName) {
                     console.error("Room find/create failed for client:", clientId);
                     socket.emit('login_fail', { message: "채팅방 생성에 실패했습니다." });
                     return;
                }
                
                // 1-3. 소켓 정보 저장 및 입장
                socket.userId = clientId;
                socket.userType = userType;
                socket.userRoom = room.roomName; 
                socket.join(room.roomName);

                connectedUsers[socket.id] = { userId: clientId, userType: userType, userRoom: room.roomName };

                socket.emit('login_success', { 
                    id: clientId, 
                    type: userType, 
                    room: room.roomName 
                });

                await loadMessages(socket, room.roomName);
                updateCounselorClientList();
                
            } catch (error) {
                console.error('내담자 로그인 처리 오류:', error);
                // DuplicateKey 오류가 나면 클라이언트에게 알림
                if (error.code === 11000) {
                     socket.emit('login_fail', { message: "이미 사용 중인 ID입니다. (또는 DB 오류)" });
                }
                // 여기서 disconnect는 선택 사항입니다.
            }

        } else if (userType === 'counselor' && userId === 'counselor123') {
            // 상담사 로직 (유지)
            socket.userId = userId;
            socket.userType = userType;
            socket.join('counselor_room'); 
            
            connectedUsers[socket.id] = { userId: userId, userType: userType, userRoom: 'counselor_room' };
            
            socket.emit('login_success', { id: userId, type: userType, room: null });
            updateCounselorClientList(socket);
        }
    });

    // 2. 메시지 전송
    socket.on('send_message', async (data) => {
        
        const roomName = socket.userType === 'client' 
                         ? socket.userRoom       
                         : data.targetRoom;       
    
        if (!roomName || !connectedUsers[socket.id]) return; 

        try {
            // 2. 메시지 객체 생성 및 저장
            const message = new Message({
                sender: socket.userId,
                message: data.message,
                roomName: roomName, // 👈 [!!! 실시간 업데이트를 위한 핵심 필드 !!!]
                timestamp: new Date(),
                read: false 
            });

            await message.save();
            
            // 3. 같은 방에 있는 모든 클라이언트에게 메시지 전송
            io.to(roomName).emit('receive_message', {
                sender: message.sender,
                message: message.message,
                timestamp: message.timestamp.toISOString(), 
                roomName: message.roomName, // 👈 클라이언트에게 roomName 포함 전송
                read: message.read
            });
            
            // 4. 상담사에게 목록 업데이트 알림 (알림 뱃지 업데이트용)
            updateCounselorClientList();

        } catch (error) {
            console.error('메시지 전송 및 저장 오류:', error);
        }
    });

    // 3. 상담사: 채팅방 선택 및 읽음 처리
    socket.on('select_chat_room', async (roomName) => {
        if (socket.userType !== 'counselor') return;

        await Message.updateMany(
            { roomName: roomName, read: false, sender: { $ne: socket.userId } },
            { $set: { read: true } }
        );

        await loadMessages(socket, roomName);
        updateCounselorClientList(); 
        io.to(roomName).emit('messages_read'); 
    });
    
    // 4. 메시지 읽음 처리 (실시간 메시지 수신 시 발생)
    socket.on('mark_as_read', async (data) => {
        if (socket.userType !== 'counselor' || !data.roomName) return;
        
        await Message.updateMany(
            { roomName: data.roomName, read: false, sender: { $ne: socket.userId } },
            { $set: { read: true } }
        );
        
        updateCounselorClientList();
        io.to(data.roomName).emit('messages_read'); 
    });


    // 5. 상담/로그아웃 종료 및 연결 해제
    socket.on('end_counseling', async () => {
        if (socket.userType === 'client' && socket.userRoom) {
            await Room.updateOne({ roomName: socket.userRoom }, { $set: { isOnline: false } });
        }
        delete connectedUsers[socket.id];
        socket.disconnect();
        updateCounselorClientList();
    });

    socket.on('disconnect', async () => {
        if (socket.userType === 'client' && socket.userRoom) {
            await Room.updateOne({ roomName: socket.userRoom }, { $set: { isOnline: false } });
        }
        
        delete connectedUsers[socket.id];
        updateCounselorClientList();
    });
});


// ----------------------------------------------------
// 서버 헬퍼 함수
// ----------------------------------------------------

async function loadMessages(socket, roomName) {
    try {
        const messages = await Message.find({ roomName: roomName })
            .sort({ timestamp: 1 })
            .lean(); 

        const formattedMessages = messages.map(msg => ({
            sender: msg.sender,
            message: msg.message,
            timestamp: msg.timestamp.toISOString(),
            roomName: msg.roomName,
            read: msg.read
        }));

        socket.emit('load_messages', formattedMessages);

    } catch (error) {
        console.error('메시지 로드 오류:', error);
    }
}

async function updateCounselorClientList(targetSocket = io) {
    try {
        const rooms = await Room.find().lean();
        
        const clientListWithCounts = await Promise.all(rooms.map(async (room) => {
            const unreadCount = await Message.countDocuments({ 
                roomName: room.roomName, 
                read: false, 
                sender: { $ne: room.counselorId } 
            });
            
            return {
                id: room.clientId,
                roomName: room.roomName,
                isOnline: room.isOnline,
                unreadCount: unreadCount 
            };
        }));
        
        targetSocket.to('counselor_room').emit('client_list_update', clientListWithCounts);

    } catch (error) {
        console.error('내담자 목록 업데이트 오류:', error);
    }
}


// 서버 시작
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
    updateCounselorClientList(); 
});