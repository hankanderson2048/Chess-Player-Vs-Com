const game = new Chess();
const board = Chessboard('board', {
  draggable: true,
  position: 'start',
  onDragStart: onDragStart,
  onDrop: onDrop,
  onSnapEnd: onSnapEnd // Added to ensure board syncs after snapback
});

const statusEl = document.getElementById('status');

function onDragStart(source, piece, position, orientation) {
  // Prevent dragging if game is over or not White's turn
  if (game.game_over() || game.turn() !== 'w') {
    statusEl.innerHTML = 'Wait for Black (AI) to move';
    console.log('Drag blocked: Not White\'s turn or game over');
    return false;
  }

  // Only allow dragging White pieces
  if (!piece || !piece.startsWith('w')) {
    console.log('Drag blocked: Not a White piece', piece);
    return false;
  }

  // Check for legal moves from this square
  const legalMoves = game.moves({ square: source, verbose: true });
  if (!legalMoves || legalMoves.length === 0) {
    console.log('Drag blocked: No legal moves from', source);
    return false;
  }

  console.log('Drag allowed: Legal moves from', source, legalMoves);
  return true;
}

function onDrop(source, target) {
  // Ensure it's White's turn (redundant but for safety)
  if (game.turn() !== 'w') {
    statusEl.innerHTML = 'Wait for Black (AI) to move';
    console.log('Drop blocked: Not White\'s turn');
    return 'snapback';
  }

  // Attempt the move
  const move = game.move({ from: source, to: target, promotion: 'q' });
  if (move === null) {
    statusEl.innerHTML = 'Illegal move, try again';
    console.log('Illegal move attempted:', source, 'to', target);
    return 'snapback'; // Snap back on illegal move
  }

  updateStatus();
  console.log('Legal move made:', move);

  // Request AI move for Black
  if (!game.game_over() && game.turn() === 'b') {
    statusEl.innerHTML = 'AI thinking...';
    getAIMove(game.pgn()).then(aiMove => {
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
    }).catch(err => {
      statusEl.innerHTML = `Error: Failed to connect to AI (${err.message})`;
      console.error('AI move error:', err);
    });
  }

  return undefined; // Allow the move
}

function onSnapEnd() {
  // Sync board with game state after snapback
  board.position(game.fen());
  console.log('Snapback occurred, board synced');
}

async function getAIMove(movesSoFar) {
  try {
    const response = await fetch("https://hjy3ayrjaf.execute-api.us-west-1.amazonaws.com/move", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": "MY_SECRET_KEY_123"
      },
      body: JSON.stringify({ moves: movesSoFar || "" })
    });

    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }

    const data = await response.json();
    if (data.error) {
      throw new Error(data.error);
    }
    return data.next_move || null;
  } catch (err) {
    console.error("Error calling API:", err);
    return null;
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