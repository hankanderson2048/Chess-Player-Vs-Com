const game = new Chess();
const board = Chessboard('board', {
  draggable: true,
  position: 'start',
  onDrop: onDrop
});

const statusEl = document.getElementById('status');

async function onDrop(source, target) {
  // See if move is legal
  const move = game.move({ from: source, to: target, promotion: 'q' });
  if (move === null) return 'snapback';

  updateStatus();

  // Request AI move for Black
  if (!game.game_over() && game.turn() === 'b') {
    try {
      const aiMove = await getAIMove(game.pgn());
      if (aiMove) {
        game.move(aiMove);
        board.position(game.fen());
        updateStatus();
      } else {
        statusEl.innerHTML = 'Error: Could not get AI move';
      }
    } catch (err) {
      statusEl.innerHTML = 'Error: Failed to connect to AI';
      console.error('AI move error:', err);
    }
  }
}

async function getAIMove(pgn) {
  try {
    const response = await fetch("https://hjy3ayrjaf.execute-api.us-west-1.amazonaws.com/move", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": "MY_SECRET_KEY_123" // TODO: Move to secure storage
      },
      body: JSON.stringify({ moves: pgn })
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