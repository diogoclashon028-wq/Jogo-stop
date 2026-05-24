const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});
const path = require('path');

app.use(express.static(path.join(__dirname, '')));

const salas = {};

function gerarCodigoSala() {
    const letras = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let cod = '';
    for (let i = 0; i < 4; i++) {
        cod += letras.charAt(Math.floor(Math.random() * letras.length));
    }
    return cod;
}

io.on('connection', (socket) => {
    console.log('🔌 Usuário conectado:', socket.id);

    // CRIAR SALA
    socket.on('criarSala', (nomeHost) => {
        const codigo = gerarCodigoSala();
        salas[codigo] = {
            code: codigo,
            host: socket.id,
            players: [{ id: socket.id, name: nomeHost, points: 0, timeTaken: 0 }],
            categories: ['Nome', 'Animal', 'Objeto', 'Fruta'],
            allowedLetters: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''),
            usedLetters: [],
            currentLetter: '',
            roundTime: 60,
            maxRounds: 5,
            currentRound: 0,
            ptsAcerto: 10,
            ptsRepetido: 5,
            maxPlayers: 8,
            gameMode: 'regressiva',
            topWinnersCount: 3,
            status: 'lobby',
            respostasRodada: {},
            votosContagem: {}
        };
        socket.join(codigo);
        socket.emit('salaCriada', codigo);
        io.to(codigo).emit('roomUpdated', salas[codigo]);
    });

    // ENTRAR NA SALA
    socket.on('joinRoom', ({ roomCode, name }) => {
        const codigo = roomCode.toUpperCase();
        const sala = salas[codigo];
        
        if (!sala) return socket.emit('erro', 'Sala não encontrada!');
        if (sala.status !== 'lobby') return socket.emit('erro', 'O jogo já começou!');
        if (sala.players.length >= sala.maxPlayers) return socket.emit('erro', 'A sala está cheia!');

        sala.players.push({ id: socket.id, name: name, points: 0, timeTaken: 0 });
        socket.join(codigo);
        io.to(codigo).emit('roomUpdated', sala);
    });

    // SINCRONIZAR CONFIGURAÇÕES (Lobby)
    socket.on('updateSettings', (config) => {
        const sala = Object.values(salas).find(s => s.host === socket.id);
        if (!sala) return;

        sala.roundTime = parseInt(config.roundTime) || 60;
        sala.maxRounds = parseInt(config.maxRounds) || 5;
        sala.ptsAcerto = parseInt(config.ptsAcerto) || 10;
        sala.ptsRepetido = parseInt(config.ptsRepetido) || 5;
        sala.maxPlayers = parseInt(config.maxPlayers) || 8;
        sala.gameMode = config.gameMode || 'regressiva';
        sala.topWinnersCount = parseInt(config.topWinnersCount) || 3;

        io.to(sala.code).emit('roomUpdated', sala);
    });

    // GERENCIAR TEMAS
    socket.on('addCategory', (cat) => {
        const sala = Object.values(salas).find(s => s.host === socket.id);
        if (sala && cat && !sala.categories.includes(cat)) {
            sala.categories.push(cat);
            io.to(sala.code).emit('roomUpdated', sala);
        }
    });

    socket.on('removeCategory', (cat) => {
        const sala = Object.values(salas).find(s => s.host === socket.id);
        if (sala) {
            sala.categories = sala.categories.filter(c => c !== cat);
            io.to(sala.code).emit('roomUpdated', sala);
        }
    });

    // FILTRAR LETRAS DO SORTEIO
    socket.on('toggleLetter', (letra) => {
        const sala = Object.values(salas).find(s => s.host === socket.id);
        if (sala) {
            if (sala.allowedLetters.includes(letra)) {
                if (sala.allowedLetters.length > 1) {
                    sala.allowedLetters = sala.allowedLetters.filter(l => l !== letra);
                }
            } else {
                sala.allowedLetters.push(letra);
            }
            io.to(sala.code).emit('roomUpdated', sala);
        }
    });

    // EXPULSAR JOGADOR (KICK)
    socket.on('kickPlayer', (idAlvo) => {
        const sala = Object.values(salas).find(s => s.host === socket.id);
        if (!sala) return;

        sala.players = sala.players.filter(p => p.id !== idAlvo);
        io.to(idAlvo).emit('playerKicked');
        
        const socketAlvo = io.sockets.sockets.get(idAlvo);
        if (socketAlvo) socketAlvo.leave(sala.code);

        io.to(sala.code).emit('roomUpdated', sala);
    });

    // INICIAR RODADA
    socket.on('startRound', () => {
        const sala = Object.values(salas).find(s => s.host === socket.id);
        if (!sala) return;

        const disponiveis = sala.allowedLetters.filter(l => !sala.usedLetters.includes(l));
        if (disponiveis.length === 0) sala.usedLetters = [];

        const listaSorteio = disponiveis.length > 0 ? disponiveis : sala.allowedLetters;
        const letraEscolhida = listaSorteio[Math.floor(Math.random() * listaSorteio.length)];

        sala.usedLetters.push(letraEscolhida);
        sala.currentLetter = letraEscolhida;
        sala.currentRound++;
        sala.status = 'jogando';
        sala.respostasRodada = {};
        sala.votosContagem = {};

        io.to(sala.code).emit('roundStarted', {
            round: sala.currentRound,
            maxRounds: sala.maxRounds,
            letter: sala.currentLetter,
            categories: sala.categories,
            gameMode: sala.gameMode,
            roundTime: sala.roundTime
        });
    });

    // NOTIFICAR QUEM APERTOU STOP
    socket.on('notifyStop', () => {
        const sala = Object.values(salas).find(s => s.players.some(p => p.id === socket.id));
        if (!sala || sala.status !== 'jogando') return;

        const jogador = sala.players.find(p => p.id === socket.id);
        if (jogador) {
            io.to(sala.code).emit('playerPressedStop', { name: Math.max, name: jogador.name, id: socket.id });
        }
    });

    // RECEBER RESPOSTAS INDIVIDUAIS
    socket.on('pressStop', (dados) => {
        const sala = Object.values(salas).find(s => s.players.some(p => p.id === socket.id));
        if (!sala) return;

        sala.respostasRodada[socket.id] = {
            respostas: dados.respostas || {},
            timeTaken: dados.timeTaken || 0,
            playerName: sala.players.find(p => p.id === socket.id)?.name || 'Anônimo'
        };

        const jogador = sala.players.find(p => p.id === socket.id);
        if (jogador) jogador.timeTaken = dados.timeTaken || 0;

        const todosRespondidos = sala.players.every(p => sala.respostasRodada[p.id] !== undefined);

        if (todosRespondidos || sala.gameMode === 'classico') {
            sala.status = 'votacao';
            io.to(sala.code).emit('abrirVotacao', {
                respostas: sala.respostasRodada,
                categories: sala.categories,
                letter: sala.currentLetter
            });
        }
    });

    // COMPUTAR VOTOS DA AVALIAÇÃO
    socket.on('computarVotos', (votosInvalidos) => {
        const sala = Object.values(salas).find(s => s.players.some(p => p.id === socket.id));
        if (!sala) return;

        sala.votosContagem[socket.id] = votosInvalidos;

        const todosVotaram = sala.players.every(p => sala.votosContagem[p.id] !== undefined);
        if (todosVotaram) {
            processarPontosRodada(sala);
        }
    });

    function processarPontosRodada(sala) {
        const totalVotantes = sala.players.length;
        const rejeitadas = {};

        Object.values(sala.votosContagem).forEach(lista => {
            if (Array.isArray(lista)) {
                lista.forEach(chave => { rejeitadas[chave] = (rejeitadas[chave] || 0) + 1; });
            }
        });

        sala.categories.forEach(cat => {
            const palavrasValidas = {};

            sala.players.forEach(p => {
                const dadosUser = sala.respostasRodada[p.id];
                if (!dadosUser || !dadosUser.respostas || !dadosUser.respostas[cat]) return;

                const palavra = dadosUser.respostas[cat].trim().toUpperCase();
                const chaveVoto = `${p.id}-${cat}`;
                const votosContra = rejeitadas[chaveVoto] || 0;

                // Validação: Letra inicial correta + Não rejeitado pela maioria
                if (palavra.length > 0 && palavra.startsWith(sala.currentLetter.toUpperCase()) && votosContra < (totalVotantes / 2)) {
                    palavrasValidas[palavra] = palavrasValidas[palavra] || [];
                    palavrasValidas[palavra].push(p.id);
                }
            });

            Object.keys(palavrasValidas).forEach(palavra => {
                const ids = palavrasValidas[palavra];
                if (ids.length === 1) {
                    const j = sala.players.find(p => p.id === ids[0]);
                    if (j) j.points += sala.ptsAcerto;
                } else {
                    ids.forEach(id => {
                        const j = sala.players.find(p => p.id === id);
                        if (j) j.points += sala.ptsRepetido;
                    });
                }
            });
        });

        if (sala.currentRound >= sala.maxRounds) {
            sala.status = 'final';
            const ranking = [...sala.players].sort((a, b) => b.points - a.points);
            const podio = ranking.slice(0, sala.topWinnersCount);
            io.to(sala.code).emit('fimDeJogo', { ranking: ranking, podio: podio });
        } else {
            sala.status = 'lobby';
            sala.respostasRodada = {};
            sala.votosContagem = {};
            io.to(sala.code).emit('roomUpdated', sala);
        }
    }

    // TRATAR DESCONEXÃO SEM QUEBRAR O FLUXO
    socket.on('disconnect', () => {
        Object.keys(salas).forEach(codigo => {
            const sala = salas[codigo];
            if (!sala) return;

            const existe = sala.players.some(p => p.id === socket.id);
            if (!existe) return;

            sala.players = sala.players.filter(p => p.id !== socket.id);

            if (sala.players.length === 0) {
                delete salas[codigo];
            } else {
                if (sala.host === socket.id) sala.host = sala.players[0].id;
                
                if (sala.status === 'votacao') {
                    delete sala.votosContagem[socket.id];
                    const todosVotaram = sala.players.every(p => sala.votosContagem[p.id] !== undefined);
                    if (todosVotaram) processarPontosRodada(sala);
                    return;
                }
                io.to(codigo).emit('roomUpdated', sala);
            }
        });
    });
});

const PORT = process.env.PORT || 10000;
http.listen(PORT, '0.0.0.0', () => console.log(`🚀 Servidor ativo na porta ${PORT}`));
        
