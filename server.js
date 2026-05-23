const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Usa a porta que o Render fornecer ou a 10000 por padrão
const PORT = process.env.PORT || 10000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});


let salas = {};

io.on('connection', (socket) => {
    console.log('Novo jogador conectado:', socket.id);

    socket.on('criarSala', (nomeSala) => {
        if (!salas[nomeSala]) {
            salas[nomeSala] = { jogadores: [], jogoIniciado: false };
            socket.join(nomeSala);
            salas[nomeSala].jogadores.push(socket.id);
            socket.emit('salaCriada', nomeSala);
            console.log(`Sala ${nomeSala} criada por ${socket.id}`);
        } else {
            socket.emit('erro', 'Sala já existe.');
        }
    });

    socket.on('disconnect', () => {
        console.log('Jogador desconectado:', socket.id);
    });
});

// Escuta em todas as interfaces de rede (sem 'localhost')
server.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
