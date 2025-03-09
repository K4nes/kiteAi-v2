import 'dotenv/config';
import axios from 'axios';
import fs from 'fs';
import chalk from 'chalk';
import logUpdate from 'log-update'; // For dynamically updating the console output

// Environment variables
const WALLET_ADDRESSES = process.env.WALLET_ADDRESSES ? process.env.WALLET_ADDRESSES.split(',') : [];
const AGENT_ID = process.env.AGENT_ID ? process.env.AGENT_ID.toLowerCase() : null; // Ensure lowercase

// Check if required environment variables are set
if (!WALLET_ADDRESSES.length || !AGENT_ID) {
    console.error(chalk.red('Error: Missing required environment variables.'));
    console.error(chalk.red('Please ensure WALLET_ADDRESSES and AGENT_ID are set in your .env file.'));
    process.exit(1); // Exit the script with an error code
}

// Main API URL
const MAIN_API_URL = `https://deployment-${AGENT_ID}.stag-vxzy.zettablock.com/main`;

// Report Usage API URL
const REPORT_USAGE_API_URL = 'https://quests-usage-dev.prod.zettablock.com/api/report_usage';

// Read messages from JSON file
const messages = JSON.parse(fs.readFileSync('messages.json', 'utf-8'));

// Function to create a progress tracker for each wallet address
function createProgressTracker(walletAddresses) {
    const progress = {};
    walletAddresses.forEach((wallet) => {
        progress[wallet] = {
            completed: 0,
            total: messages.length,
            status: 'Processing...',
        };
    });
    return progress;
}

// Function to render the progress dynamically
function renderProgress(progress) {
    let output = '';
    for (const [wallet, data] of Object.entries(progress)) {
        output += `${chalk.blue.bold(`Wallet: ${wallet}`)}\n`;
        output += `  Progress: ${data.completed}/${data.total}\n`;
        output += `  Status: ${data.status}\n`;
        output += '\n';
    }
    logUpdate(output); // Dynamically update the console output
}

// Function to process a single message for a wallet
async function processMessage(walletAddress, message, progress) {
    const startTime = Date.now();
    let ttft = null;
    let responseText = '';

    try {
        // Make the main API request
        const response = await axios({
            method: 'post',
            url: MAIN_API_URL,
            headers: {
                'Content-Type': 'application/json',
                'Host': `deployment-${AGENT_ID}.stag-vxzy.zettablock.com`,
                'Origin': 'https://agents.testnet.gokite.ai',
                'Referer': 'https://agents.testnet.gokite.ai/',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'
            },
            data: {
                message: message,
                stream: true
            },
            responseType: 'stream'
        });

        // Process the streamed response
        response.data.on('data', (chunk) => {
            if (!ttft) {
                ttft = Date.now() - startTime;
            }
            responseText += chunk.toString();
        });

        // Wait for the stream to finish
        await new Promise((resolve, reject) => {
            response.data.on('end', resolve);
            response.data.on('error', reject);
        });

        const totalTime = Date.now() - startTime;

        // Prepare the payload for the report usage API
        const reportPayload = {
            agent_id: `deployment_${AGENT_ID}`,
            request_metadata: {},
            request_text: message,
            response_text: responseText,
            total_time: totalTime,
            ttft: ttft,
            wallet_address: walletAddress
        };

        // Send the report usage request
        const reportResponse = await axios.post(REPORT_USAGE_API_URL, reportPayload, {
            headers: {
                'Content-Type': 'application/json'
            }
        });

        // Update progress
        progress[walletAddress].completed += 1;
        progress[walletAddress].status = `Processed: ${message.substring(0, 20)}...`; // Truncate long messages
        renderProgress(progress); // Update the output dynamically
    } catch (error) {
        progress[walletAddress].status = chalk.red(`Error: ${error.message}`);
        renderProgress(progress); // Update the output with the error
    }
}

// Function to format time (hours, minutes, seconds)
function formatTime(ms) {
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((ms % (1000 * 60)) / 1000);
    return `${hours}h ${minutes}m ${seconds}s`;
}

// Main function
async function runScript() {
    const progress = createProgressTracker(WALLET_ADDRESSES);

    // Render initial progress
    renderProgress(progress);

    // Process all wallets concurrently
    await Promise.all(
        WALLET_ADDRESSES.map(async (walletAddress) => {
            for (const message of messages) {
                await processMessage(walletAddress, message, progress);
            }
            // Mark wallet as completed
            progress[walletAddress].status = chalk.green('Completed');
            renderProgress(progress);
        })
    );

    // Final render to ensure all updates are displayed
    logUpdate.done(); // Stop dynamic updates

    // Schedule the script to restart after 24 hours
    console.log(chalk.yellow('Script completed. Restarting in 24 hours...'));

    // Start the 24-hour countdown
    const restartTime = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
    let remainingTime = restartTime;

    const countdownInterval = setInterval(() => {
        remainingTime -= 1000; // Decrease by 1 second
        logUpdate(chalk.yellow(`Time until restart: ${formatTime(remainingTime)}`)); // Dynamically update the countdown

        if (remainingTime <= 0) {
            clearInterval(countdownInterval); // Stop the countdown
            logUpdate.done(); // Stop dynamic updates
            console.log(chalk.yellow('Restarting script now...'));
            runScript(); // Restart the script
        }
    }, 1000); // Update every second
}

// Start the script
runScript();

// Handle process termination (e.g., Ctrl+C)
process.on('SIGINT', () => {
    console.log(chalk.yellow('\nScript terminated by user. Exiting...'));
    process.exit(0);
});