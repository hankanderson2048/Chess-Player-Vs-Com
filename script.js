const game = new Chess();
const board = Chessboard('board', {
    draggable: true,
    position: 'start',
    onDragStart: onDragStart,
    onDrop: onDrop,
    onSnapEnd: onSnapEnd
});

const statusEl = document.getElementById('status');

// Initialize AWS SDK for Cognito
AWS.config.region = 'us-west-1';
const userPoolId = 'us-west-1_YOUR_USER_POOL_ID'; // Replace with your User Pool ID
const clientId = 'YOUR_APP_CLIENT_ID'; // Replace with your App Client ID
const userPool = new AWSCognito.CognitoIdentityServiceProvider.CognitoUserPool({
    UserPoolId: userPoolId,
    ClientId: clientId
});

let userId = null; // Set after authentication
let idToken = null; // Cognito ID token for API requests

async function authenticateUser(username, password) {
    const authenticationDetails = new AWSCognito.CognitoIdentityServiceProvider.AuthenticationDetails({
        Username: username,
        Password: password
    });
    const cognitoUser = new AWSCognito.CognitoIdentityServiceProvider.CognitoUser({
        Username: username,
        Pool: userPool
    });

    return new Promise((resolve, reject) => {
        cognitoUser.authenticateUser(authenticationDetails, {
            onSuccess: (result) => {
                idToken = result.getIdToken().getJwtToken();
                userId = result.getIdToken().payload.sub;
                console.log('Authenticated user, userId:', userId);
                resolve({ idToken, userId });
            },
            onFailure: (err) => {
                console.error('Authentication error:', err);
                reject(err);
            },
            newPasswordRequired: (userAttributes) => {
                // Handle new password requirement (e.g., for first login)
                cognitoUser.completeNewPasswordChallenge(password, {}, {
                    onSuccess: (result) => {
                        idToken = result.getIdToken().getJwtToken();
                        userId = result.getIdToken().payload.sub;
                        console.log('New password set, userId:', userId);
                        resolve({ idToken, userId });
                    },
                    onFailure: (err) => reject(err)
                });
            }
        });
    });
}

async function signUp(username, password, email) {
    const attributeList = [
        new AWSCognito.CognitoIdentityServiceProvider.CognitoUserAttribute({
            Name: 'email',
            Value: email
        })
    ];
    return new Promise((resolve, reject) => {
        userPool.signUp(username, password, attributeList, null, (err, result) => {
            if (err) {
                console.error('Sign-up error:', err);
                reject(err);
            } else {
                console.log('User signed up:', result.user.getUsername());
                resolve(result.user);
            }
        });
    });
}

function onDragStart(source, piece, position, orientation) {
    if (!userId) {
        statusEl.innerHTML = 'Please log in to play';
        console.log('Drag blocked: User not authenticated');
        return false;
    }
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
    if (!userId) {
        statusEl.innerHTML = 'Please log in to play';
        console.log('Drop blocked: User not authenticated');
        return 'snapback';
    }
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
    console.log('Legal move made:', move);
    updateStatus();

    if (!game.game_over() && game.turn() === 'b') {
        statusEl.innerHTML = 'AI thinking...';
        try {
            console.log('Sending PGN to server:', game.pgn());
            const response = await fetch("https://hjy3ayrjaf.execute-api.us-west-1.amazonaws.com/move", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${idToken}`
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
    if (!userId) {
        statusEl.innerHTML = 'Please log in to resume a game';
        console.log('Resume blocked: User not authenticated');
        return;
    }
    try {
        statusEl.innerHTML = 'Loading game...';
        const response = await fetch("https://hjy3ayrjaf.execute-api.us-west-1.amazonaws.com/move", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${idToken}`
            },
            body: JSON.stringify({ action: "resume", userId: userId })
        });
        if (!response.ok) {
            throw new Error(`HTTP error: ${response.status}`);
        }
        const data = await response.json();
        if (data.error) {
            statusEl.innerHTML = `Error: ${data.error}`;
            console.error('Resume error:', data.error);
            return;
        }
        const pgn = data.pgn;
        if (pgn) {
            try {
                const valid = game.load_pgn(pgn);
                if (!valid) {
                    throw new Error('Invalid PGN format');
                }
                board.position(game.fen());
                updateStatus();
                console.log('Game resumed with PGN:', pgn);
            } catch (err) {
                statusEl.innerHTML = `Error: Failed to load PGN (${err.message})`;
                console.error('PGN load error:', err);
            }
        } else {
            statusEl.innerHTML = 'No saved game found';
            console.log('No PGN returned from server');
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
    // Login form
    const loginForm = document.createElement('form');
    loginForm.id = 'loginForm';
    loginForm.innerHTML = `
        <input type="text" id="username" placeholder="Username" required>
        <input type="password" id="password" placeholder="Password" required>
        <button type="submit">Login</button>
    `;
    document.body.appendChild(loginForm);

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;
        try {
            const { idToken: token, userId: uid } = await authenticateUser(username, password);
            idToken = token;
            userId = uid;
            statusEl.innerHTML = 'Logged in, ready to play';
            updateStatus();
        } catch (err) {
            statusEl.innerHTML = `Login failed: ${err.message}`;
            console.error('Login error:', err);
        }
    });

    // Sign-up form
    const signupForm = document.createElement('form');
    signupForm.id = 'signupForm';
    signupForm.innerHTML = `
        <input type="text" id="signupUsername" placeholder="Username" required>
        <input type="email" id="signupEmail" placeholder="Email" required>
        <input type="password" id="signupPassword" placeholder="Password" required>
        <button type="submit">Sign Up</button>
    `;
    document.body.appendChild(signupForm);

    signupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('signupUsername').value;
        const email = document.getElementById('signupEmail').value;
        const password = document.getElementById('signupPassword').value;
        try {
            await signUp(username, password, email);
            statusEl.innerHTML = 'Sign-up successful, please verify your email';
        } catch (err) {
            statusEl.innerHTML = `Sign-up failed: ${err.message}`;
            console.error('Sign-up error:', err);
        }
    });

    // Resume game button
    const resumeButton = document.createElement('button');
    resumeButton.innerText = 'Resume Game';
    resumeButton.onclick = resumeGame;
    document.body.appendChild(resumeButton);

    updateStatus();
});