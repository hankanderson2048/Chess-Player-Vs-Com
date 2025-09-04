if (typeof AWS === 'undefined') {
    console.error('AWS SDK not loaded. Please ensure the AWS SDK script is included.');
    throw new Error('AWS SDK not loaded');
}
if (typeof AmazonCognitoIdentity === 'undefined') {
    console.error('Cognito Identity SDK not loaded. Please ensure the amazon-cognito-identity-js script is included.');
    throw new Error('Cognito Identity SDK not loaded');
}

const game = new Chess();
let board = null;
let statusEl = null;

let userId = null;
let idToken = null;
let gameMode = 'new';
let username = null; // Store the assigned username

// Initialize AWS SDK for Cognito
AWS.config.region = 'us-west-1';
const userPoolId = 'us-west-1_km6tXdEwN';
const clientId = 'NEW_APP_CLIENT_ID'; // Replace with your new public SPA App Client ID
const userPool = new AmazonCognitoIdentity.CognitoUserPool({
    UserPoolId: userPoolId,
    ClientId: clientId
});

async function authenticateUser(username, password) {
    const authenticationDetails = new AmazonCognitoIdentity.AuthenticationDetails({
        Username: username,
        Password: password
    });
    const cognitoUser = new AmazonCognitoIdentity.CognitoUser({
        Username: username,
        Pool: userPool
    });

    return new Promise((resolve, reject) => {
        cognitoUser.authenticateUser(authenticationDetails, {
            onSuccess: (result) => {
                idToken = result.getIdToken().getJwtToken();
                userId = result.getIdToken().payload.sub;
                console.log('Authenticated user, username:', username); // Use stored username
                resolve({ idToken, userId });
            },
            onFailure: (err) => {
                console.error('Authentication error:', err);
                reject(err);
            },
            newPasswordRequired: (userAttributes) => {
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

async function signUp(usernameParam, password, email) {
    const attributeList = [
        new AmazonCognitoIdentity.CognitoUserAttribute({
            Name: 'email',
            Value: email
        })
    ];
    return new Promise((resolve, reject) => {
        userPool.signUp(usernameParam, password, attributeList, null, (err, result) => {
            if (err) {
                console.error('Sign-up error:', err);
                reject(err);
            } else {
                console.log('User signed up with username:', usernameParam);
                resolve({ user: result.user, username: usernameParam });
            }
        });
    });
}

function onDragStart(source, piece, position, orientation) {
    if (!userId || !idToken) {
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
    if (!userId || !idToken) {
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
    if (!userId || !idToken) {
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
                gameMode = 'resumed';
                updateStatus();
                console.log('Game resumed with PGN:', pgn);
            } catch (err) {
                statusEl.innerHTML = `Error: Failed to load PGN (${err.message})`;
                console.error('PGN load error:', err);
            }
        } else {
            statusEl.innerHTML = 'No saved game found';
            console.log('No PGN returned from server');
            gameMode = 'new';
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
    status += ` (Mode: ${gameMode}, User: ${username || 'Unknown'})`; // Display username
    statusEl.innerHTML = status;
}

document.addEventListener('DOMContentLoaded', () => {
    const loginContainer = document.createElement('div');
    loginContainer.id = 'loginContainer';
    loginContainer.style.display = 'block';
    loginContainer.innerHTML = `
        <h2>Login</h2>
        <form id="loginForm">
            <input type="text" id="username" placeholder="Username" required>
            <input type="password" id="password" placeholder="Password" required>
            <button type="submit">Login</button>
        </form>
        <p>Don't have an account? <button id="showSignup">Sign Up</button></p>
    `;
    document.body.appendChild(loginContainer);

    const signupContainer = document.createElement('div');
    signupContainer.id = 'signupContainer';
    signupContainer.style.display = 'none';
    signupContainer.innerHTML = `
        <h2>Sign Up</h2>
        <form id="signupForm">
            <input type="text" id="signupUsername" placeholder="Username" required>
            <input type="email" id="signupEmail" placeholder="Email" required>
            <input type="password" id="signupPassword" placeholder="Password" required>
            <button type="submit">Sign Up</button>
        </form>
        <p>Already have an account? <button id="showLogin">Login</button></p>
    `;
    document.body.appendChild(signupContainer);

    const gameContainer = document.createElement('div');
    gameContainer.id = 'gameContainer';
    gameContainer.style.display = 'none';
    gameContainer.innerHTML = `
        <div id="board" style="width: 400px"></div>
        <div id="status"></div>
        <button id="resumeButton">Resume Game</button>
    `;
    document.body.appendChild(gameContainer);

    statusEl = document.getElementById('status');

    document.getElementById('loginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;
        try {
            const { idToken: token, userId: uid } = await authenticateUser(username, password);
            idToken = token;
            userId = uid;
            loginContainer.style.display = 'none';
            signupContainer.style.display = 'none';
            gameContainer.style.display = 'block';
            board = Chessboard('board', {
                draggable: true,
                position: 'start',
                onDragStart: onDragStart,
                onDrop: onDrop,
                onSnapEnd: onSnapEnd
            });
            gameMode = 'new';
            updateStatus();
        } catch (err) {
            statusEl.innerHTML = `Login failed: ${err.message || err}`;
            console.error('Login error:', err);
        }
    });

    document.getElementById('signupForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const usernameParam = document.getElementById('signupUsername').value;
        const email = document.getElementById('signupEmail').value;
        const password = document.getElementById('signupPassword').value;
        try {
            const result = await signUp(usernameParam, password, email);
            username = usernameParam; // Store the username
            // Add confirmation step
            const code = prompt('Enter the verification code sent to your email:');
            const cognitoUser = new AmazonCognitoIdentity.CognitoUser({
                Username: usernameParam,
                Pool: userPool
            });
            await new Promise((resolve, reject) => {
                cognitoUser.confirmRegistration(code, true, (err, result) => {
                    if (err) {
                        console.error('Confirmation error:', err);
                        reject(err);
                    } else {
                        console.log('Confirmation successful');
                        resolve(result);
                    }
                });
            });
            statusEl.innerHTML = 'Sign-up and confirmation successful, please log in';
            signupContainer.style.display = 'none';
            loginContainer.style.display = 'block';
        } catch (err) {
            statusEl.innerHTML = `Sign-up failed: ${err.message || err}`;
            console.error('Sign-up error:', err);
        }
    });

    document.getElementById('showSignup').addEventListener('click', () => {
        loginContainer.style.display = 'none';
        signupContainer.style.display = 'block';
    });
    document.getElementById('showLogin').addEventListener('click', () => {
        signupContainer.style.display = 'none';
        loginContainer.style.display = 'block';
    });

    document.getElementById('resumeButton').addEventListener('click', resumeGame);
});