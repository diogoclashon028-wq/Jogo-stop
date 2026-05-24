            
const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

let salas = {};

io.on('connection', (socket) => {
    
    // EVENTO ATUALIZADO: Cria a sala e embaralha as letras do alfabeto
    socket.on('criarSala', (nomeJogador) => {
        const codigoSala = Math.random().toString(36).substring(2, 7).toUpperCase();
        
        // 1. Criamos a lista com o alfabeto padrão completo
        let letras = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z'];
        
        // 2. ALGORITMO DE EMBARALHAMENTO (Fisher-Yates): Mistura as letras completamente
        for (let i = letras.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [letras[i], letras[letras[j]]] = [letras[j], letras[i]];
        }

        // 3. Montamos o objeto da sala com as letras já misturadas
        salas[codigoSala] = {
            code: codigoSala, 
            host: socket.id,
            players: [{ id: socket.id, name: nomeJogador, points: 0, submitted: false, answers: {}, timeTaken: 0 }],
            categories: ['Nome', 'CEP', 'Cor', 'Fruta'],
            allowedLetters: letras, // Salva o alfabeto embaralhado
            maxRounds: 5, 
            roundTime: 60, 
            currentRound: 0, 
            gameState: 'lobby', 
            currentLetter: '',
            ptsAcerto: 10, 
            ptsRepetido: 5
        };
        
        socket.join(codigoSala);
        socket.emit('salaCriada', codigoSala);
        io.to(codigoSala).emit('roomUpdated', salas[codigoSala]);
    });

    socket.on('joinRoom', ({ roomCode, name }) => {
        const codigo = roomCode.toUpperCase();
        if (salas[codigo]) {
            salas[codigo].players.push({ id: socket.id, name: name, points: 0, submitted: false, answers: {}, timeTaken: 0 });
            socket.join(codigo);
            io.to(codigo).emit('roomUpdated', salas[codigo]);
        } else {
            socket.emit('erro', 'Sala não encontrada!');
        }
    });

    socket.on('addCategory', (categoria) => {
        const sala = Object.values(salas).find(s => s.host === socket.id);
        if (sala && !sala.categories.includes(categoria)) {
            sala.categories.push(categoria);
            io.to(sala.code).emit('roomUpdated', sala);
        }
    });

    socket.on('removeCategory', (categoria) => {
        const sala = Object.values(salas).find(s => s.host === socket.id);
        if (sala) {
            sala.categories = sala.categories.filter(c => c !== categoria);
            io.to(sala.code).emit('roomUpdated', sala);
        }
    });

    socket.on('toggleLetter', (letra) => {
        const sala = Object.values(salas).find(s => s.host === socket.id);
        if (sala) {
            if (sala.allowedLetters.includes(letra)) {
                sala.allowedLetters = sala.allowedLetters.filter(l => l !== letra);
            } else {
                sala.allowedLetters.push(letra);
            }
            io.to(sala.code).emit('roomUpdated', sala);
        }
    });

    socket.on('updateSettings', (data) => {
        const sala = Object.values(salas).find(s => s.host === socket.id);
        if (sala) {
            sala.maxRounds = parseInt(data.maxRounds) || sala.maxRounds;
            sala.roundTime = parseInt(data.roundTime) || sala.roundTime;
            sala.ptsAcerto = parseInt(data.ptsAcerto) || sala.ptsAcerto;
            sala.ptsRepetido = parseInt(data.ptsRepetido) || sala.ptsRepetido;
            io.to(sala.code).emit('roomUpdated', sala);
        }
    });

    socket.on('startRound', () => {
        const sala = Object.values(salas).find(s => s.host === socket.id || s.players.some(p => p.id === socket.id));
        
        if (sala && (sala.host === socket.id)) {
            if (sala.allowedLetters.length === 0) {
                return socket.emit('erro', 'Não restaram mais letras disponíveis no alfabeto selecionado!');
            }
            sala.currentRound++;
            sala.gameState = 'playing';
            
            // Como a lista já está embaralhada, pegar a primeira letra (índice 0) já é 100% aleatório!
            sala.currentLetter = sala.allowedLetters[0];
            sala.allowedLetters.splice(0, 1); // Remove a letra usada para não repetir
            
            sala.players.forEach(p => { p.submitted = false; p.answers = {}; p.timeTaken = 0; });
            
            io.to(sala.code).emit('roundStarted', {
                round: sala.currentRound, maxRounds: sala.maxRounds,
                letter: sala.currentLetter, categories: sala.categories, roundTime: sala.roundTime
            });
            io.to(sala.code).emit('roomUpdated', sala);
        }
    });

    socket.on('pressStop', ({ respostas, tempoGasto }) => {
        const sala = Object.values(salas).find(s => s.players.some(p => p.id === socket.id));
        if (sala && sala.gameState === 'playing') {
            const jogador = sala.players.find(p => p.id === socket.id);
            jogador.answers = respostas;
            jogador.timeTaken = tempoGasto;
            jogador.submitted = true;

            io.to(sala.code).emit('stopPressionado', jogador.name);
            io.to(sala.code).emit('roomUpdated', sala);

            const todosEnviaram = sala.players.every(p => p.submitted);
            if (todosEnviaram) {
                calcularPontuacaoERevisao(sala);
            }
        }
    });

    socket.on('submitAnswers', ({ respostas, tempoGasto }) => {
        const sala = Object.values(salas).find(s => s.players.some(p => p.id === socket.id));
        if (sala && sala.gameState === 'playing') {
            const jogador = sala.players.find(p => p.id === socket.id);
            if (!jogador.submitted) {
                jogador.answers = respostas;
                jogador.timeTaken = tempoGasto;
                jogador.submitted = true;
            }
            
            io.to(sala.code).emit('roomUpdated', sala);

            const todosEnviaram = sala.players.every(p => p.submitted);
            if (todosEnviaram) {
                calcularPontuacaoERevisao(sala);
            }
        }
    });
});

function calcularPontuacaoERevisao(sala) {
    sala.gameState = 'reviewing';

    sala.categories.forEach(cat => {
        let contagemRespostas = {};
        
        // Validação: Só aceita palavras que comecem com a letra sorteada
        sala.players.forEach(p => {
            let ans = (p.answers[cat] || '').trim().toUpperCase();
            if (ans.length > 0 && ans.startsWith(sala.currentLetter)) {
                contagemRespostas[ans] = (contagemRespostas[ans] || 0) + 1;
            }
        });

        // Distribuição dos pontos configurados no painel do host
        sala.players.forEach(p => {
            let ans = (p.answers[cat] || '').trim().toUpperCase();
            if (ans.length > 0 && ans.startsWith(sala.currentLetter)) {
                if (contagemRespostas[ans] > 1) {
                    p.points += sala.ptsRepetido;
                } else {
                    p.points += sala.ptsAcerto;
                }
            }
        });
    });

    const ranking = [...sala.players].sort((a, b) => b.points - a.points);
    const acabouJogo = sala.currentRound >= sala.maxRounds;

    io.to(sala.code).emit('showReviewTable', {
        hostId: sala.host,
        players: sala.players, ranking: ranking, categories: sala.categories, isLastRound: acabouJogo
    });
}

http.listen(PORT, () => console.log("Servidor ativo e rodando perfeitamente!"));
                    
