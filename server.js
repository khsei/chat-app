// server.js

// ----------------------------------------------------
// 1. 모듈 로드 및 서버 초기화                        
// ----------------------------------------------------
// 웹 서버 및 실시간 통신 기능 준비
const express = require('express'); // Express (웹 프레임워크)모듈, Express 모듈을 로드합니다. 웹 애플리케이션 및 API 서버를 구축하는 데 사용되는 Node.js의 대표적인 웹 프레임워크입니다.
const http = require('http');       // http (Node.js 내장 서버)모듈, Node.js 내장 http 모듈을 로드합니다. Express 앱을 서버로 감싸서 Socket.IO와 함께 사용할 때 필요합니다.
const socketio = require('socket.io'); // Socket.IO (실시간 통신) 모듈, Socket.IO 모듈을 로드합니다. 웹소켓 기반의 실시간 양방향 통신을 쉽게 구현하게 해주는 라이브러리입니다.
// 데이터베이스 연동 준비 : Mongoose 모듈을 로드합니다. Node.js에서 MongoDB를 쉽게 다룰 수 있게 해주는 ODM (Object Data Modeling) 라이브러리입니다.
const mongoose = require('mongoose');  // Mongoose 모듈을 로드합니다. Node.js에서 MongoDB를 쉽게 다룰 수 있게 해주는 ODM (Object Data Modeling) 라이브러리입니다.

// 서버 인스턴스 초기화: Express 앱을 생성하고 이를 기반으로 HTTP 서버를 생성합니다.
const app = express();                  // 로드한 express 함수를 실행하여 Express 애플리케이션 인스턴스를 생성합니다.
const server = http.createServer(app);  // Express 앱(app)을 인자로 넘겨 HTTP 서버를 생성합니다. Socket.IO는 이 HTTP 서버 위에서 동작하게 됩니다.
// Socket.IO 서버 초기화: Socket.IO 서버를 HTTP 서버에 연결하고, 추가 옵션을 설정합니다.
const io = socketio(server, {           // Socket.IO 서버를 초기화하고 위에서 생성한 HTTP 서버에 연결합니다. 이제 실시간 통신을 위한 웹소켓 핸들링이 가능합니다.
    cors: {                             // 외부 접속 허용 설정: CORS (Cross-Origin Resource Sharing) 설정입니다. 다른 도메인(origin: * = 모든 도메인)의 클라이언트가 GET, POST 방식으로 Socket.IO 서버에 접속하는 것을 허용합니다.
        origin: "*", 
        methods: ["GET", "POST"]
    }
});

// ----------------------------------------------------
// 2. MongoDB 연결 설정 (Mongoose)                    
// ----------------------------------------------------

// MongoDB 연결 설정 (⚠️ YOUR_DB_URI를 실제 연결 문자열로 대체하세요!)
// [수정] serverSelectionTimeoutMS를 추가하여 연결 시 타임아웃 오류 방지 (IP 화이트리스트 오류를 대비한 코드적 안전장치)
const MONGO_URI = 'mongodb+srv://ddwee:ddwee8944@cluster0.rk0mf1y.mongodb.net/counseling_chat?appName=Cluster0';  // DB 연결 주소 설정: MongoDB Atlas 연결 문자열 (URI)을 변수로 정의합니다. (실제 사용 시 반드시 보안에 유의해야 합니다.)

mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 15000 }) // DB 연결: MongoDB에 연결을 시도합니다. serverSelectionTimeoutMS 옵션은 연결 시도 시간을 15초로 제한하여 네트워크나 설정 오류 시 서버가 무한정 대기하는 것을 방지합니다.
    .then(() => console.log('MongoDB 연결 성공'))                   // 비동기 연결 결과 처리: Promise 체인을 사용하여 연결 성공/실패 시의 콘솔 메시지를 처리합니다.
    .catch(err => console.error('MongoDB 연결 오류:', err));

// ----------------------------------------------------
// 3. MongoDB 스키마 및 모델 정의
// ----------------------------------------------------

// 1. 메시지 스키마
const MessageSchema = new mongoose.Schema({         // 메시지 데이터 구조 정의: 채팅 메시지의 구조를 정의하는 Mongoose 스키마를 생성합니다.
    sender: String,                                 // 필드 정의 (타입, 기본값 포함): 메시지의 발신자, 내용, 채팅방 이름(roomName), 발송 시각(timestamp), 읽음 상태(read) 등의 필드를 정의합니다.
    message: String,
    roomName: { type: String, required: true }, 
    timestamp: { type: Date, default: Date.now },
    read: { type: Boolean, default: false } 
});
const Message = mongoose.model('Message', MessageSchema);  // DB 컬렉션 모델 생성: 정의된 MessageSchema를 기반으로 Message 모델을 생성합니다. Mongoose는 이 모델을 사용하여 DB 컬렉션(messages)과 상호작용합니다.

// 2. 채팅방 스키마 (RoomName과 ClientId에 고유 인덱스가 있으므로 DuplicateKey 오류에 취약합니다)
const RoomSchema = new mongoose.Schema({                                            // 채팅방 데이터 구조 정의: 채팅방의 정보를 정의하는 스키마를 생성합니다.
    roomName: { type: String, unique: true, required: true }, // [unique: true]     // 고유한 방 이름 설정: 채팅방 이름 필드를 정의합니다. unique: true는 이 값이 DB 전체에서 고유해야 함을 의미합니다.
    clientId: { type: String, unique: true, required: true }, // [unique: true]     // 내담자 ID 설정: 내담자 ID 필드를 정의합니다. 내담자당 하나의 채팅방만 존재하도록 보장합니다.
    counselorId: { type: String, default: 'counselor123' },
    isOnline: { type: Boolean, default: true }                                      // 접속 상태 저장: 내담자의 현재 접속 상태를 저장합니다.
});
const Room = mongoose.model('Room', RoomSchema);                                    // DB 컬렉션 모델 생성: 정의된 RoomSchema를 기반으로 Room 모델을 생성합니다.


// ----------------------------------------------------
// 4. 전역 상태 관리
// ----------------------------------------------------

const connectedUsers = {};                              // 서버 내 실시간 상태 관리: 현재 접속 중인 사용자 소켓 ID를 키로 하는 객체입니다. DB 외에 서버 메모리에 실시간 사용자 상태를 저장합니다.

// ----------------------------------------------------
// 5. Express 설정
// ----------------------------------------------------

app.use(express.static('public'));                      // 정적 파일 서빙: public 폴더의 파일을 정적 파일(HTML, CSS, JS 등)로 설정하여 클라이언트가 직접 접근할 수 있도록 합니다.

app.get('/', (req, res) => {                            // 기본 페이지 제공: 루트 URL (/)로 GET 요청이 들어오면 public 폴더의 client.html 파일을 응답합니다.
    res.sendFile(__dirname + '/public/client.html');
});


// ----------------------------------------------------
// 6. Socket.IO 이벤트 핸들러 (메인 로직)
// ----------------------------------------------------

io.on('connection', (socket) => {                           // 소켓 연결 이벤트 처리: 클라이언트가 서버에 웹소켓 연결을 시도할 때마다 실행되는 함수입니다. socket은 개별 클라이언트와의 연결입니다.
    console.log('새로운 사용자 연결됨:', socket.id);           

    // 1. 로그인/접속
    socket.on('login', async ({ userId, userType }) => {    // 로그인 요청 처리 시작: 클라이언트가 로그인 요청을 보낼 때 실행됩니다. DB 작업을 위해 async 키워드를 사용합니다.
        let room;

        if (userType === 'client') {
            
            // 1-1. 내담자 ID 및 방 이름 결정
            const clientId = userId.length > 0 ? userId : `client_${socket.id.substring(0, 8)}`;  // 내담자 ID 및 방 이름 생성: 내담자 ID가 없으면 소켓 ID 기반의 익명 ID를 생성하고, 채팅방 이름(room_clientId)을 생성합니다.
            const generatedRoomName = `room_${clientId}`; // [수정] roomName을 명시적으로 생성
            
            try {
                // 1-2. 채팅방 찾거나 생성 (findOneAndUpdate)
                room = await Room.findOneAndUpdate(                                      // 채팅방 관리 (찾기 또는 생성): MongoDB에서 해당 clientId로 채팅방을 찾거나 (find), 없으면 생성합니다(upsert: true)
                    { clientId: clientId }, // 내담자 ID로 방을 찾는다.                     // 찾았든 새로 생성했든 isOnline: true로 설정하고, 새로 생성될 때만 roomName을 설정($setOnInsert)합니다. new: true는 업데이트 후의 문서를 반환하라는 의미입니다.
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
                socket.userId = clientId;           // 소켓 상태 저장 및 방 참여: 소켓 객체에 사용자 ID, 유형, 방 이름 정보를 저장하고, Socket.IO 방에 참여시킵니다.
                socket.userType = userType;
                socket.userRoom = room.roomName; 
                socket.join(room.roomName);

                connectedUsers[socket.id] = { userId: clientId, userType: userType, userRoom: room.roomName };  // 서버 메모리 상태 관리: 서버의 전역 상태(connectedUsers)에도 접속 정보를 기록합니다.

                socket.emit('login_success', { 
                    id: clientId, 
                    type: userType, 
                    room: room.roomName 
                });

                await loadMessages(socket, room.roomName);  // 과거 메시지 로드: 아래 정의된 헬퍼 함수를 호출하여 DB에서 과거 메시지를 불러와 클라이언트에게 전송합니다.
                updateCounselorClientList();                // 목록 업데이트 요청: 아래 정의된 헬퍼 함수를 호출하여 상담사 목록을 업데이트합니다 (내담자 접속 상태 변경 알림).
                
            } catch (error) {
                console.error('내담자 로그인 처리 오류:', error);
                // DuplicateKey 오류가 나면 클라이언트에게 알림
                if (error.code === 11000) {                     // DB 고유성 오류 처리: RoomSchema에 설정된 unique: true 제약 조건 위반(DuplicateKey 오류)이 발생하면 클라이언트에게 알립니다.
                     socket.emit('login_fail', { message: "이미 사용 중인 ID입니다. (또는 DB 오류)" });
                }
                // 여기서 disconnect는 선택 사항입니다.
            }

        } else if (userType === 'counselor' && userId === 'counselor123') {
            // 상담사 로직 (유지)
            socket.userId = userId;
            socket.userType = userType;
            socket.join('counselor_room');              // 상담사 그룹 방 참여: 상담사는 특정 내담자 방이 아닌, 전체 상담사 그룹 방에 조인합니다. (목록 업데이트를 받기 위함)
            
            connectedUsers[socket.id] = { userId: userId, userType: userType, userRoom: 'counselor_room' };
            
            socket.emit('login_success', { id: userId, type: userType, room: null });
            updateCounselorClientList(socket);
        }
    });

    // 2. 메시지 전송
    socket.on('send_message', async (data) => {
        
        const roomName = socket.userType === 'client'   //메시지 대상 방 결정: 메시지를 보낼 채팅방 이름을 결정합니다. 내담자는 자신의 방, 상담사는 메시지 데이터에 포함된 대상 방을 사용합니다.
                         ? socket.userRoom       
                         : data.targetRoom;       
    
        if (!roomName || !connectedUsers[socket.id]) return; 

        try {
            // 2. 메시지 객체 생성 및 저장
            const message = new Message({       // 메시지 DB 저장: 새 메시지 객체를 생성하고, MongoDB의 Message 컬렉션에 저장합니다.
                sender: socket.userId,
                message: data.message,
                roomName: roomName, // 👈 [!!! 실시간 업데이트를 위한 핵심 필드 !!!]
                timestamp: new Date(),
                read: false 
            });

            await message.save();
            
            // 3. 같은 방에 있는 모든 클라이언트에게 메시지 전송
            io.to(roomName).emit('receive_message', {       // 메시지 실시간 전송: 해당 방에 조인된 모든 사용자에게 메시지를 실시간으로 전송합니다.
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

        await Message.updateMany(                           // 메시지 읽음 처리 (DB 반영): 상담사가 방을 선택했을 때 (혹은 mark_as_read 요청 시), 선택된 방의 안 읽은 메시지 중 상담사가 보낸 메시지가 아닌 것들을 찾아 read: true로 일괄 업데이트합니다.
            { roomName: roomName, read: false, sender: { $ne: socket.userId } },
            { $set: { read: true } }
        );

        await loadMessages(socket, roomName);
        updateCounselorClientList(); 
        io.to(roomName).emit('messages_read');  //내담자에게 읽음 상태 알림: 해당 방의 내담자에게 읽음 상태가 변경되었음을 알립니다.
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
            await Room.updateOne({ roomName: socket.userRoom }, { $set: { isOnline: false } });     // 접속 상태 DB 업데이트: 내담자가 end_counseling 또는 disconnect 되었을 때, Room 컬렉션에서 해당 방의 isOnline 상태를 false로 변경하여 접속 해제를 DB에 반영합니다.
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