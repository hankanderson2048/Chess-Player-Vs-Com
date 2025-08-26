const game = new Chess();
const board = Chessboard('board', {
  draggable: true,
  position: 'start',
  onDragStart: onDragStart,
  onDrop: onDrop
});

const statusEl = document.getElementById('status');

function onDragStart(source, piece, position, orientation) {
  // Only allow dragging during White's turn
  if (game.game_over() || game.turn() !== 'w') {
    statusEl.innerHTML = 'Wait for Black (AI) to move';
    return false; // Prevent dragging if game is over or not White's turn
  }

  // Only allow dragging White pieces
  if (!piece.startsWith('w')) {
    return false; // Prevent dragging Black pieces
  }

  // Check if there are legal moves from this square
  const legalMoves = game.moves({ square: source, verbose: true });
  if (legalMoves.length === 0) {
    return false; // Prevent dragging if no legal moves exist
  }

  return true; // Allow dragging
}

async function onDrop(source, target) {
  // Restrict moves to White's turn (redundant but kept for safety)
  if (game.turn() !== 'w') {
    statusEl.innerHTML = 'Wait for Black (AI) to move';
    return 'snapback';
  }

  // See if move is legal
  const move = game.move({ from: source, to: target, promotion: 'q' });
  if (move === null) return 'snapback';

  updateStatus();

  // Request AI move for Black
  if (!game.game_over() && game.turn() === 'b') {
    try {
      statusEl.innerHTML = 'AI thinking...';
      const aiMove = await getAIMove(game.pgn());
      if (aiMove) {
        try {
          game.move(aiMove);
          board.position(game.fen());
          updateStatus();
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
}

async function getAIMove(movesSoFar) {
  try {
    const response = await fetch("https://hjy3ayrjaf.execute-api.us-west-1.amazonaws.com/move", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": "MY_SECRET_KEY_123"
      },
      body: JSON.stringify({ moves: movesSoFar || "" }) // Handle empty PGN
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