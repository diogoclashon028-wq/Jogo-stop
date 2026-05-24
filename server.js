const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Configuração de CORS para liberar conexões e Ping/Pong para estabilidade no Render
const io = new Server(server, {
    cors: {
        origin: "*", 
        methods: ["GET", "POST"]
    },
    pingTimeout: 60000,
    pingInterval: 25000
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

// Rota para a página inicial (Index)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'), (err) => {
        if (err) {
            res.sendFile(path.join(__dirname, 'public', 'index.html'));
        }
    });
});

// ADICIONADO: Rota explícita para entregar o arquivo lobby.html e evitar o erro de "Não foi possível obter"
app.get('/lobby.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'lobby.html'), (err) => {
        if (err) {
            // Se não encontrar na raiz, tenta buscar dentro da pasta public
            res.sendFile(path.join(__dirname, 'public', 'lobby.html'));
        }
    });
});

// Banco de dados em memória para armazenar as salas de jogo
const salas = {};

function gerarCodigoSala() {
    const letras = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let codigo = '';
    for (let i = 0; i < 4; i++) {
        codigo += letras.charAt(Math.floor(Math.random() * letras.length));
    }
    return codigo;
}

io.on('connection', (socket) => {
    console.log(`Usuário conectado: ${socket.id}`);

    // --- EVENTO: CRIAR SALA ---
    socket.on('criarSala', (nomeJogador) => {
        const codigoSala = gerarCodigoSala();
        
        salas[codigoSala] = {
            code: codigoSala,
            host: socket.id,
            gameState: 'lobby',
            gameMode: 'classico',
            useVoting: 'sim',
            maxPlayers: 10, // Limite padrão inicial
            maxRounds: 5,
            roundTime: 60,
            ptsAcerto: 10,
            ptsRepetido: 5,
            currentRound: 0,
            currentLetter: '',
            categories: ['Nome', 'Animal', 'Objeto', 'Fruta'],
            allowedLetters: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''),
            players: [],
            votes: {}
        };

        const sala = salas[codigoSala];
        
        sala.players.push({
            id: socket.id,
            name: nomeJogador,
            points: 0,
            answers: {},
            tempoGasto: 0
        });

        socket.join(codigoSala);
        socket.emit('salaCriado', codigoSala);
        io.to(codigoSala).emit('roomUpdated', sala);
    });

    // --- EVENTO: ENTRAR EM SALA EXISTENTE ---
    socket.on('joinRoom', (data) => {
        const { roomCode, name } = data;
        const sala = salas[roomCode];

        if (!sala) {
            return socket.emit('erro', 'Sala não encontrada!');
        }
        if (sala.gameState !== 'lobby') {
            return socket.emit('erro', 'O jogo nesta sala já começou!');
        }

        // Validação do limite de vagas configurado pelo Host
        if (sala.players.length >= sala.maxPlayers) {
            return socket.emit('erro', `A sala está cheia! Limite máximo de ${sala.maxPlayers} jogadores.`);
        }

        sala.players.push({
            id: socket.id,
            name: name,
            points: 0,
            answers: {},
            tempoGasto: 0
        });

        socket.join(roomCode);
        io.to(roomCode).emit('roomUpdated', sala);
    });

    // --- EVENTO: ATUALIZAR CONFIGURAÇÕES DA SALA (HOST) ---
    socket.on('updateSettings', (data) => {
        const sala = Object.values(salas).find(s => s.host === socket.id);
        if (!sala) return;

        sala.gameMode = data.gameMode;
        sala.useVoting = data.useVoting;
        sala.maxPlayers = parseInt(data.maxPlayers) || 10;
        sala.maxRounds = parseInt(data.maxRounds) || 5;
        sala.roundTime = parseInt(data.roundTime) || 60;
        sala.ptsAcerto = parseInt(data.ptsAcerto) || 10;
        sala.ptsRepetido = parseInt(data.ptsRepetido) || 5;

        io.to(sala.code).emit('roomUpdated', sala);
    });

    // --- EVENTO: EDITOR DE TEMAS - ADICIONAR CATEGORIA (HOST) ---
    socket.on('addCategory', (categoria) => {
        const sala = Object.values(salas).find(s => s.host === socket.id);
        if (!sala || !categoria) return;

        const formatada = categoria.trim();
        if (formatada && !sala.categories.includes(formatada)) {
            sala.categories.push(formatada);
            io.to(sala.code).emit('roomUpdated', sala);
        }
    });

    // --- EVENTO: EDITOR DE TEMAS - REMOVER CATEGORIA (HOST) ---
    socket.on('removeCategory', (categoria) => {
        const sala = Object.values(salas).find(s => s.host === socket.id);
        if (!sala) return;

        sala.categories = sala.categories.filter(cat => cat !== categoria);
        io.to(sala.code).emit('roomUpdated', sala);
    });

    // --- EVENTO: GERENCIADOR DO ALFABETO - ATIVAR/DESATIVAR LETRA (HOST) ---
    socket.on('toggleLetter', (letra) => {
        const sala = Object.values(salas).find(s => s.host === socket.id);
        if (!sala) return;

        if (sala.allowedLetters.includes(letra)) {
            if (sala.allowedLetters.length > 1) {
                sala.allowedLetters = sala.allowedLetters.filter(l => l !== letra);
            } else {
                return socket.emit('erro', 'Você precisa deixar ao menos uma letra ativa!');
            }
        } else {
            sala.allowedLetters.push(letra);
        }
        io.to(sala.code).emit('roomUpdated', sala);
    });

    // --- EVENTO: INICIAR RODADA ---
    socket.on('startRound', () => {
        const sala = Object.values(salas).find(s => s.host === socket.id);
        if (!sala) return;

        if (sala.allowedLetters.length === 0) {
            return socket.emit('erro', 'Nenhuma letra disponível no alfabeto selecionado!');
        }

        const indexSorteado = Math.floor(Math.random() * sala.allowedLetters.length);
        sala.currentLetter = sala.allowedLetters[indexSorteado];

        sala.currentRound++;
        sala.gameState = 'jogando';
        sala.votes = {};

        sala.players.forEach(p => {
            p.answers = {};
            p.tempoGasto = 0;
        });

        io.to(sala.code).emit('roundStarted', {
            letter: sala.currentLetter,
            categories: sala.categories,
            round: sala.currentRound,
            maxRounds: sala.maxRounds
        });
        io.to(sala.code).emit('roomUpdated', sala);
    });

    // --- EVENTO: PRESSIONAR STOP / FIM DA RODADA ---
    socket.on('pressStop', (data) => {
        const sala = Object.values(salas).find(s => s.players.some(p => p.id === socket.id));
        if (!sala || sala.gameState !== 'jogando') return;

        const jogadorQueEnviou = sala.players.find(p => p.id === socket.id);
        if (jogadorQueEnviou) {
            jogadorQueEnviou.answers = data.respostas || {};
            jogadorQueEnviou.tempoGasto = data.tempoGasto || 0;
        }

        if (sala.useVoting === 'nao') {
            sala.players.forEach(p => {
                sala.categories.forEach(cat => {
                    let resposta = (p.answers && p.answers[cat]) ? p.answers[cat].trim() : "";
                    
                    if (resposta !== "" && resposta.toLowerCase().startsWith(sala.currentLetter.toLowerCase())) {
                        
                        let repetido = sala.players.some(outro => 
                            outro.id !== p.id && 
                            outro.answers && 
                            outro.answers[cat] && 
                            outro.answers[cat].trim().toLowerCase() === resposta.toLowerCase()
                        );
                        
                        let ptsAcerto = parseInt(sala.ptsAcerto) || 10;
                        let ptsRepetido = parseInt(sala.ptsRepetido) || 5;
                        
                        p.points += repetido ? ptsRepetido : ptsAcerto;
                    }
                });
            });

            sala.gameState = 'ranking';

            let rankingEnvio = sala.players.map(p => ({
                id: p.id,
                name: p.name,
                points: p.points,
                tempoGasto: p.tempoGasto,
                answers: p.answers
            })).sort((a, b) => b.points - a.points);

            io.to(sala.code).emit('showReviewTable', { 
                ranking: rankingEnvio, 
                isLastRound: sala.currentRound >= sala.maxRounds 
            });
            io.to(sala.code).emit('roomUpdated', sala);

        } else {
            sala.gameState = 'revisao';
            io.to(sala.code).emit('abrirRevisao', {
                hostId: sala.host,
                categories: sala.categories,
                players: sala.players.map(p => ({ id: p.id, name: p.name, answers: p.answers }))
            });
            io.to(sala.code).emit('roomUpdated', sala);
        }
    });

    // --- EVENTO: PROCESSAR VOTO MANUAL RECEBIDO ---
    socket.on('votarPalavra', (data) => {
        const { playerTargetId, categoria, voto } = data;
        const sala = Object.values(salas).find(s => s.players.some(p => p.id === socket.id));
        if (!sala) return;

        if (!sala.votes[playerTargetId]) sala.votes[playerTargetId] = {};
        if (!sala.votes[playerTargetId][categoria]) sala.votes[playerTargetId][categoria] = { sim: 0, nao: 0 };

        sala.votes[playerTargetId][categoria][voto]++;
    });

    // --- EVENTO: CALCULAR VOTOS E AVANÇAR PARA O RANKING (HOST) ---
    socket.on('aplicarVotosEAvancar', () => {
        const sala = Object.values(salas).find(s => s.host === socket.id);
        if (!sala || sala.gameState !== 'revisao') return;

        sala.players.forEach(p => {
            sala.categories.forEach(cat => {
                let resposta = p.answers[cat] ? p.answers[cat].trim() : "";
                if (!resposta) return;

                if (!resposta.toLowerCase().startsWith(sala.currentLetter.toLowerCase())) return;

                let apuracao = (sala.votes[p.id] && sala.votes[p.id][cat]) ? sala.votes[p.id][cat] : { sim: 1, nao: 0 };
                
                if (apuracao.nao >= apuracao.sim) return;

                let repetido = sala.players.some(outro => 
                    outro.id !== p.id && 
                    outro.answers && 
                    outro.answers[cat] && 
                    outro.answers[cat].trim().toLowerCase() === resposta.toLowerCase()
                );

                let ptsAcerto = parseInt(sala.ptsAcerto) || 10;
                let ptsRepetido = parseInt(sala.ptsRepetido) || 5;

                p.points += repetido ? ptsRepetido : ptsAcerto;
            });
        });

        sala.gameState = 'ranking';

        let rankingEnvio = sala.players.map(p => ({
            id: p.id,
            name: p.name,
            points: p.points,
            tempoGasto: p.tempoGasto,
            answers: p.answers
        })).sort((a, b) => b.points - a.points);

        io.to(sala.code).emit('showReviewTable', { 
            ranking: rankingEnvio, 
            isLastRound: sala.currentRound >= sala.maxRounds 
        });
        io.to(sala.code).emit('roomUpdated', sala);
    });

    // --- EVENTO: QUANDO UM JOGADOR SE DESCONECTA ---
    socket.on('disconnect', () => {
        console.log(`Usuário desconectado: ${socket.id}`);
        
        Object.keys(salas).forEach(codigoSala => {
            const sala = salas[codigoSala];
            sala.players = sala.players.filter(p => p.id !== socket.id);

            if (sala.players.length === 0) {
                delete salas[codigoSala];
            } else {
                if (sala.host === socket.id) {
                    sala.host = sala.players[0].id;
                }
                io.to(codigoSala).emit('roomUpdated', sala);
            }
        });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor ativo na porta *:${PORT}`);
});
              
