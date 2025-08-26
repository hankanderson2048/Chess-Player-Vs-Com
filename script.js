// Initialize chess logic
const game = new Chess();

// Create the board
const board = Chessboard('board', {
  draggable: true,
  position: 'start',
  onDrop: handleMove
});

// Handle player move
function handleMove(source, target) {
  const move = game.move({ from: source, to: target, promotion: 'q' });

  // Illegal move
  if (move === null) return 'snapback';

  // Update board after legal move
  board.position(game.fen());

  // Ask AI to move
  fetchAiMove();
}

// Fetch AI move from Lambda API
async function fetchAiMove() {
  const moves = game.history(); // moves so far
  try {
    const res = await fetch("https://hjy3ayrjaf.execute-api.us-west-1.amazonaws.com/move", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": "MY_SECRET_KEY_123" },
      body: JSON.stringify({ moves })
    });

    const data = await res.json();
    const aiMove = data.next_move;

    if (aiMove) {
      game.move(aiMove);
      board.position(game.fen());
    }
  } catch (err) {
    console.error("AI move failed:", err);
  }
}
