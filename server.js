const express = require('express');
const path = require('path');
const fs = require('fs');
const Account = require('./models/account');
const Message = require('./models/message');

const jwt = require('jsonwebtoken');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const app = express();
const server = require('http').createServer(app);
const { Server } = require('socket.io');
const { PORT, CLIENT_URL } = process.env;

const io = new Server(server, {
    cors: {
        origin: CLIENT_URL,
        credentials: true
    },
    cookie: {
        name: 'token',
        path: '/',
        httpOnly: true,
        sameSite: 'none',
        secure: true
    }
});

const onlineUsers = {};
const users = {};
let privateKey = fs.readFileSync('./key/privatekey.pem');
let publicKey = fs.readFileSync('./key/publickey.crt');

app.use(
    cors({
        origin: CLIENT_URL,
        credentials: true
    })
);

app.use('/public', express.static(path.join(__dirname, '/public')));
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => {
    res.send('Home page');
});

io.on('connection', (socket) => {
    let identity = null;
    let cookieArr = socket.handshake.headers.cookie.split('; ');
    let accessTokenStr = cookieArr.find((cookie) => {
        return cookie.startsWith('accessToken=');
    });

    socket.on('file', async (data) => {
        const parts = data.file.name.split('.');
        const ext = parts[parts.length-1];
        const fileName = parts[0] + Date.now() + '.' + ext;
        const pathUpload = path.join(__dirname + '/public/uploads/' +  fileName);

        fs.writeFile(pathUpload, data.file.data, (err, data) => {
            if(err) throw err;
            console.log('save sucess');
        })

        await Message.create({
            fileName,
            senderId: data.senderId,
            receiverId: data.receiverId
        });
        const toSocketId = users[data.receiverId];
        const fromSocketId = users[data.senderId];

        io.to(toSocketId).emit('file_user', {
            fileName,
            senderId: data.senderId,
            receiverId: data.receiverId
        });

        io.to(fromSocketId).emit('file_user', {
            fileName,
            senderId: data.senderId,
            receiverId: data.receiverId
        });
    })

    socket.on('message', async (data) => {
        await Message.create({
            message: data.message,
            senderId: data.senderId,
            receiverId: data.receiverId
        });

        const toSocketId = users[data.receiverId];
        io.to(toSocketId).emit('message_user', {
            message: data.message,
            senderId: data.senderId,
            receiverId: data.receiverId
        });
    });

    if (accessTokenStr) {
        let accessToken = accessTokenStr.split('=')[1];
        jwt.verify(accessToken, publicKey, {}, (err, data) => {
            if (err) return res.sendStatus(403).send('lỗi token');
            const { id, username} = data;
            identity = id;
            users[id] = socket.id;
            // tên key là id của mongodb và value là socket.id
            // vì socket.id luôn làm mới nên ta phải lưu trữ nó lại
            // socket.id không thể bị edit được
            onlineUsers[id] = {
                userId: id,
                username: username
            };

            io.emit('user_online', onlineUsers);

            socket.on('disconnect', () => {
                delete onlineUsers[identity];
                io.emit('user_online', onlineUsers);
            });
        });
    } else {
        socket.disconnect();
    }
});

const getUserDataFromRequest = async (req) => {
    const token = req.cookies?.accessToken;
    return new Promise((resolve, reject) => {
        if (!token) {
            const error = new Error('no token');
            reject(error);
        }

        jwt.verify(token, publicKey, {}, (err, data) => {
            if (err) return reject(err);
            return resolve(data);
        });
    });
};

app.get('/user', async (req, res) => {
    try {
        let userList = await Account.find({}, 'username');
        return res.status(200).send(userList);
    } catch (error) {
        console.log(error);
        return res.sendStatus(500);
    }
});

app.post('/message/:userId', async (req, res) => {
    try {
        const userId = req.params?.userId;
        const restUser = await getUserDataFromRequest(req);
        const restUserId = restUser.id;
        let result = await Message.find({
            senderId: { $in: [userId, restUserId] },
            receiverId: { $in: [userId, restUserId] }
        }).sort({ createdAt: 1 });

        res.status(200).send(result);
    } catch (error) {
        return res.sendStatus(500);
    }
});

app.get('/profile', (req, res) => {
    try {
        const token = req.cookies?.accessToken;
        if (!token) {
            return res.status(401).send('Lỗi token: Không tìm thấy token');
        }

        jwt.verify(token, publicKey, {}, (err, data) => {
            if (err) {
                return res.status(401).send('Lỗi token: Token không hợp lệ');
            }

            return res.status(200).send(data);
        });
    } catch (error) {
        console.error(error);
        return res.sendStatus(500);
    }
});

app.post('/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        const hashedPassword = bcrypt.hashSync(password, 10);
        let check = await Account.findOne({
            username,
            password
        });

        if (!check) {
            let createdAccount = await Account.create({
                username,
                password: hashedPassword
            });

            let privateKey = fs.readFileSync('./key/privatekey.pem');
            jwt.sign(
                { id: createdAccount._id, username: createdAccount.username },
                privateKey,
                {
                    algorithm: 'RS256'
                },
                (err, data) => {
                    if (err) {
                        console.log(err);
                        return res.status(403).send('Lỗi token');
                    }
                    return res
                        .cookie('accessToken', data, {
                            secure: true,
                            httpOnly: true,
                            sameSite: 'none'
                        })
                        .status(200)
                        .json({
                            status: 'register success',
                            result: createdAccount
                        });
                }
            );
        } else {
            return res.status(401).send('Tài khoản đã tồn tại');
        }
    } catch (error) {
        // console.log(error);
        return res.sendStatus(500);
    }
});

app.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        let passwordCmp = false;
        const user = await Account.findOne({ username });

        if (user) {
            passwordCmp = bcrypt.compareSync(password, user.password);
        }

        if (passwordCmp) {
            jwt.sign(
                { id: user._id, username: user.username },
                privateKey,
                {
                    algorithm: 'RS256'
                },
                (err, data) => {
                    if (err) {
                        console.log(err);
                        return res.status(403).send('Lỗi token');
                    }
                    return res
                        .cookie('accessToken', data, {
                            secure: true,
                            httpOnly: true,
                            sameSite: 'none'
                        })
                        .status(200)
                        .json({
                            status: 'login success',
                            result: user
                        });
                }
            );
        } else {
            return res.status(401).send('Nhập sai tài khoản hoặc mật khẩu');
        }
    } catch (error) {
        console.log(error);
        return res.sendStatus(500);
    }
});

app.post('/logout', (req, res) => {
    res.clearCookie('accessToken');
    return res.status(200).send('logout success');
});

server.listen(PORT, () => {
    console.log(`listening on port::: ${PORT}`);
});
