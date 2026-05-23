const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 10000;

// TODO O VISUAL DO SEU JOGO JÁ EMBUTIDO AQUI
const conteudoHTML = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Stop Dinâmico</title>
    <style>
        corpo, body {
            font-family: 'Segoe UI', Arial, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            margin: 0; padding: 15px; exibicao: flexivel; display: flex; justificar-conteudo: centro; align-items: center; min-height: 100vh;
        }
        .container {
            background: rgba(255, 255, 255, 0.95); preenchimento: 25px; padding: 25px; raio da borda: 16px; border-radius: 16px; sombra da caixa: 0 8px 32px rgba(0,0,0,0.2); max-width: 400px; width: 100%;
        }
        h2 { color: #4a148c; text-align: center; margin-top: 0; font-size: 28px; }
        h3 { color: #7b1fa2; borda inferior: 2px solida #d1bae7; preenchimento inferior: 5px; }
        input {
            width: 100%; padding: 12px; margin: 8px 0; box-sizing: border-box; border-radius: 8px; border: 2px solid #ddd;
        }
        button {
            width: 100%; padding: 14px; margin: 8px 0; box-sizing: border-box; border-radius: 8px; border: nenhuma; border: none; font-size: 16px; cursor: pointer; font-weight: bold;
        }
        button:ativo { transformar: escala(0.98); }
        .btn-primary { background: linear-gradient(135deg, #6a11cb 0%, #2575fc 100%); color: white; }
        .btn-success { background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%); color: white; }
        .screen { display: none; }
        .screen.active { display: block; }
    </style>
</head>
<body>
    <div class="container">
        <div id="screen-login" class="screen active">
            <h2>Stop Online!</h2>
            <input type="text" id="username" placeholder="Seu Nome">
            <button class="btn-primary" onclick="createRoom()">Criar Nova Sala</button>
            <hr style="border: 0; height: 1px; background: #ddd; margin: 15px 0;">
            <input type="text" id="room-code" placeholder="Código da Sala">
            <button class="btn-success" onclick="joinRoom()">Entrar na Sala</button>
        </div>
    </div>

    <script src="/socket.io/socket.io.js"></script>
    <script>
        const socket = io();
        function createRoom() {
            const name = document.getElementById('username').value;
            if(!name) return alert('Digite seu nome!');
            socket.emit('criarSala', 'Sala de ' + name);
        }
        function joinRoom() {
            const room = document.getElementById('room-code').value;
            if(!room) return alert('Digite o código!');
            socket.emit('joinRoom', room);
        }
        socket.on('salaCriada', (nome) => {
            alert('Sala criada: ' + nome);
        });
        socket.on('erro', (msg) => alert(msg));
    </script>
</body>
</html>
`;

// Rota principal que entrega o jogo
app.get('/', (req, res) => {
    res.send(conteudoHTML);
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

server.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
