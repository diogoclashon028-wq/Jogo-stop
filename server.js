const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});
const PORT = process.env.PORT || 3000;

// Serve o arquivo index.html na rota principal
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

let salas = {};

io.on('connection', (socket) => {

  socket.on('criarSala', (nomeJogador) => {
    const codigoSala = Math.random().toString(36).substring(2, 7).toUpperCase();
    
    let letras = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    for (let i = letras.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [letras[i], letras[j]] = [letras[j], letras[i]];
    }

    salas[codigoSala] = {
      code: codigoSala,
      host: socket.id,
      players: [{ id: socket.id, name: nomeJogador, points: 0, submitted: false, answers: {}, timeTaken: 0, waiting: false }],
      allowedLetters: letras,
      maxRounds: 5,
      roundTime: 60,
      currentRound: 0,
      gameState: 'lobby',
      currentLetter: '',
      ptsAcerto: 10,
      ptsRepetido: 5,
      gameMode: 'classico',
      history: [],
      votes: {}
    };

    socket.join(codigoSala);
    socket.emit('salaCriada', codigoSala);
    io.to(codigoSala).emit('roomUpdated', salas[codigoSala]);
  });

  socket.on('joinRoom', ({ roomCode, name }) => {
    const codigo = roomCode.toUpperCase();
    if (salas[codigo]) {
      const sala = salas[codigo];
      const emEspera = sala.gameState !== 'lobby';

      sala.players.push({
        id: socket.id,
        name: name,
        points: 0,
        submitted: emEspera,
        answers: {},
        timeTaken: 0,
        waiting: emEspera
      });

      socket.join(codigo);
      if (emEspera) {
        socket.emit('paraCarroEspera');
      }
      io.to(codigo).emit('roomUpdated', sala);
    } else {
      socket.emit('erro', 'Sala não encontrada!');
    }
  });

  socket.on('enviarProvocacao', (msg) => {
    const sala = Object.values(salas).find(s => s.players.some(p => p.id === socket.id));
    if (sala) {
      const jogador = sala.players.find(p => p.id === socket.id);
      io.to(sala.code).emit('receberProvocacao', { nome: jogador.name, mensagem: msg });
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
      sala.gameMode = data.gameMode || sala.gameMode;
      if (sala.gameMode === 'classico') {
        sala.roundTime = 60; sala.ptsAcerto = 10; sala.ptsRepetido = 5; sala.maxRounds = 5;
      } else if (sala.gameMode === 'competitivo') {
        sala.roundTime = 45; sala.ptsAcerto = 15; sala.ptsRepetido = 5; sala.maxRounds = 5;
      } else if (sala.gameMode === 'custom') {
        sala.maxRounds = parseInt(data.maxRounds) || sala.maxRounds;
        sala.roundTime = parseInt(data.roundTime) || sala.roundTime;
        sala.ptsAcerto = parseInt(data.ptsAcerto) || sala.ptsAcerto;
        sala.ptsRepetido = parseInt(data.ptsRepetido) || sala.ptsRepetido;
      }
      io.to(sala.code).emit('roomUpdated', sala);
    }
  });

  socket.on('startRound', () => {
    const sala = Object.values(salas).find(s => s.host === socket.id || s.players.some(p => p.id === socket.id));
    if (sala && sala.host === socket.id) {
      if (sala.allowedLetters.length === 0) {
        return socket.emit('erro', 'Não restaram mais letras disponíveis no alfabeto!');
      }
      sala.currentRound++;
      sala.gameState = 'playing';
      sala.votes = {};
      sala.currentLetter = sala.allowedLetters[0];
      sala.allowedLetters.splice(0, 1);

      sala.players.forEach(p => {
        p.waiting = false; p.submitted = false; p.answers = {}; p.timeTaken = 0;
      });

      io.to(sala.code).emit('roundStarted', {
        round: sala.currentRound, maxRounds: sala.maxRounds,
        letter: sala.currentLetter, categories: sala.categories, roundTime: sala.roundTime
      });
      io.to(sala.code).emit('roomUpdated', sala);
    }
  });

  socket.on('pressStop', (respostas, tempoGasto) => {
    const sala = Object.values(salas).find(s => s.players.some(p => p.id === socket.id));
    if (sala && sala.gameState === 'playing') {
      const jogador = sala.players.find(p => p.id === socket.id);
      if (jogador && !jogador.waiting) {
        jogador.answers = respostas;
        jogador.timeTaken = tempoGasto;
        jogador.submitted = true;

        if (sala.gameMode === 'competitivo') {
          io.to(sala.code).emit('stopImediato', jogador.name);
          sala.players.forEach(p => { if (!p.submitted) p.submitted = true; });
          fecharRodadaEVotacao(sala);
        } else {
          io.to(sala.code).emit('stopPressionado', jogador.name);
          io.to(sala.code).emit('roomUpdated', sala);
          if (sala.players.every(p => p.submitted)) fecharRodadaEVotacao(sala);
        }
      }
    }
  });

  socket.on('submitAnswers', (respostas, tempoGasto) => {
    const sala = Object.values(salas).find(s => s.players.some(p => p.id === socket.id));
    if (sala && sala.gameState === 'playing') {
      const jogador = sala.players.find(p => p.id === socket.id);
      if (jogador && !jogador.waiting && !jogador.submitted) {
        jogador.answers = respostas;
        jogador.timeTaken = tempoGasto;
        jogador.submitted = true;
      }
      io.to(sala.code).emit('roomUpdated', sala);
      if (sala.players.every(p => p.submitted)) fecharRodadaEVotacao(sala);
    }
  });

  socket.on('votarPalavra', ({ playerTargetId, categoria, voto }) => {
    const sala = Object.values(salas).find(s => s.players.some(p => p.id === socket.id));
    if (sala && sala.gameState === 'reviewing') {
      const chave = `${playerTargetId}-${categoria}`;
      if (!sala.votes[chave]) sala.votes[chave] = { aceitos: 0, rejeitados: 0, votantes: [] };

      if (!sala.votes[chave].votantes.includes(socket.id)) {
        sala.votes[chave].votantes.push(socket.id);
        if (voto === 'sim') sala.votes[chave].aceitos++;
        else sala.votes[chave].rejeitados++;
      }
      io.to(sala.code).emit('votosAtualizados', sala.votes);
    }
  });

  socket.on('aplicarVotosEAvancar', () => {
    const sala = Object.values(salas).find(s => s.host === socket.id);
    if (sala && sala.gameState === 'reviewing') {
      calcularPontosComVotacao(sala);
    }
  });

  socket.on('disconnect', () => {
    Object.keys(salas).forEach(codigo => {
      let sala = salas[codigo];
      sala.players = sala.players.filter(p => p.id !== socket.id);
      if (sala.players.length === 0) {
        delete salas[codigo];
      } else {
        if (sala.host === socket.id) sala.host = sala.players[0].id;
        io.to(sala.code).emit('roomUpdated', sala);
      }
    });
  });
});

function fecharRodadaEVotacao(sala) {
  sala.gameState = 'reviewing';
  io.to(sala.code).emit('abrirRevisao', {
    hostId: sala.host, players: sala.players, categories: sala.categories, letter: sala.currentLetter
  });
}

function calcularPontosComVotacao(sala) {
  let copiaRodadaInfo = { round: sala.currentRound, letter: sala.currentLetter, respostas: [] };

  sala.categories.forEach(cat => {
    let contagemRespostas = {};

    sala.players.forEach(p => {
      if (!p.waiting) {
        let ans = (p.answers[cat] || "").trim().toUpperCase();
        const chave = `${p.id}-${cat}`;
        const votacao = sala.votes[chave];
        let foiRejeitado = votacao && votacao.rejeitados > votacao.aceitos;

        if (ans.length > 0 && ans.startsWith(sala.currentLetter.toUpperCase()) && !foiRejeitado) {
          contagemRespostas[ans] = (contagemRespostas[ans] || 0) + 1;
        }
      }
    });

    sala.players.forEach(p => {
      if (!p.waiting) {
        let ans = (p.answers[cat] || "").trim().toUpperCase();
        const chave = `${p.id}-${cat}`;
        const votacao = sala.votes[chave];
        let foiRejeitado = votacao && votacao.rejeitados > votacao.aceitos;

        let pontosGanhos = 0;
        if (ans.length > 0 && ans.startsWith(sala.currentLetter.toUpperCase()) && !foiRejeitado) {
          if (contagemRespostas[ans] > 1) {
            pontosGanhos = sala.ptsRepetido;
          } else {
            pontosGanhos = sala.ptsAcerto;
          }
        }
        p.points += pontosGanhos;
        copiaRodadaInfo.respostas.push({ nome: p.name, categoria: cat, palavra: ans || '---', pontos: pontosGanhos });
      }
    });
  });

  sala.history.push(copiaRodadaInfo);
  const ranking = [...sala.players].sort((a, b) => b.points - a.points);
  const acabouJogo = sala.currentRound >= sala.maxRounds;

  io.to(sala.code).emit('showReviewTable', {
    ranking: ranking, isLastRound: acabouJogo, historicoCompleto: sala.history
  });
}

// LIGAÇÃO CORRETA USANDO O HTTP + SOCKET.IO UNIDOS
http.listen(PORT, () => console.log("Servidor Rodando na porta " + PORT));
      
