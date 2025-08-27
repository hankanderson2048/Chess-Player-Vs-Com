const game = new Chess();
const board = Chessboard('board', {
  draggable: true,
  position: 'start',
  onDragStart: onDragStart,
  onDrop: onDrop,
  onSnapEnd: onSnapEnd
});

const statusEl = document.getElementById('status');
const userId = 'user-' + Math.random().toString(36).substr(2, 9); // Simple unique user ID

function onDragStart(source, piece, position, orientation) {
  if (game.game_over() || game.turn() !== 'w') {
    statusEl.innerHTML = 'Wait for Black (AI) to move';
    console.log('Drag blocked: Not White\'s turn or game over');
    return false;
  }
  if (!piece || !piece.startsWith('w')) {
    console.log('Drag blocked: Not a White piece', piece);
    return false;
  }
  const legalMoves = game.moves({ square: source, verbose: true });
  if (!legalMoves || legalMoves.length === 0) {
    console.log('Drag blocked: No legal moves from', source);
    return false;
  }
  console.log('Drag allowed: Legal moves from', source, legalMoves);
  return true;
}

async function onDrop(source, target) {
  if (game.turn() !== 'w') {
    statusEl.innerHTML = 'Wait for Black (AI) to move';
    console.log('Drop blocked: Not White\'s turn');
    return 'snapback';
  }
  const move = game.move({ from: source, to: target, promotion: 'q' });
  if (move === null) {
    statusEl.innerHTML = 'Illegal move, try again';
    console.log('Illegal move attempted:', source, 'to', target);
    return 'snapback';
  }
  updateStatus();
  console.log('Legal move made:', move);
  if (!game.game_over() && game.turn() === 'b') {
    statusEl.innerHTML = 'AI thinking...';
    try {
      const response = await fetch("https://hjy3ayrjaf.execute-api.us-west-1.amazonaws.com/move", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": "518a47b3-8f7f-4cdd-ae16-a9824c3d1710"
        },
        body: JSON.stringify({ action: "move", userId: userId, moves: game.pgn() || "" })
      });
      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }
      const data = await response.json();
      if (data.error) {
        throw new Error(data.error);
      }
      const aiMove = data.next_move;
      if (aiMove) {
        try {
          game.move(aiMove);
          board.position(game.fen());
          updateStatus();
          console.log('AI move applied:', aiMove);
        } catch (err) {
          statusEl.innerHTML = `Error: Invalid AI move (${aiMove})`;
          console.error('Invalid AI move:', aiMove, err);
        }
      } else {
        statusEl.innerHTML = 'Error: Could not get AI move';
        console.error('No AI move returned');
      }
    } catch (err) {
      statusEl.innerHTML = `Error: Failed to connect to AI (${err.message})`;
      console.error('AI move error:', err);
    }
  }
  return undefined;
}

function onSnapEnd() {
  board.position(game.fen());
  console.log('Snapback occurred, board synced');
}

async function resumeGame() {
  try {
    statusEl.innerHTML = 'Loading game...';
    const response = await fetch("https://hjy3ayrjaf.execute-api.us-west-1.amazonaws.com/move", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": "518a47b3-8f7f-4cdd-ae16-a9824c3d1710"
      },
      body: JSON.stringify({ action: "resume", userId: userId })
    });
    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }
    const data = await response.json();
    if (data.error) {
      throw new Error(data.error);
    }
    const pgn = data.pgn;
    if (pgn) {
      game.load_pgn(pgn);
      board.position(game.fen());
      updateStatus();
      console.log('Game resumed with PGN:', pgn);
    } else {
      statusEl.innerHTML = 'No saved game found';
    }
  } catch (err) {
    statusEl.innerHTML = `Error: Failed to resume game (${err.message})`;
    console.error('Resume error:', err);
  }
}

function updateStatus() {
  let status = '';
  const moveColor = game.turn() === 'w' ? 'White' : 'Black';
  if (game.in_checkmate()) {
    status = `Game over, ${moveColor} is in checkmate.`;
  } else if (game.in_draw()) {
    status = 'Game over, drawn position';
  } else {
    status = `${moveColor} to move`;
    if (game.in_check()) {
      status += `, ${moveColor} is in check`;
    }
  }
  statusEl.innerHTML = status;
}

document.addEventListener('DOMContentLoaded', () => {
  const resumeButton = document.createElement('button');
  resumeButton.innerText = 'Resume Game';
  resumeButton.onclick = resumeGame;
  document.body.appendChild(resumeButton);
});