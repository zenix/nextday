import 'dotenv/config';
import { google } from 'googleapis';
import * as readline from 'readline';

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  'urn:ietf:wg:oauth:2.0:oob'
);

const url = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: ['https://www.googleapis.com/auth/calendar.readonly'],
});

console.log('Open this URL:', url);
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('Paste the code here: ', async (code) => {
  try {
    const { tokens } = await oauth2Client.getToken(code);
    console.log('\nSuccess! Add this to your .env file:');
    console.log('GOOGLE_REFRESH_TOKEN=' + tokens.refresh_token);
  } catch (err) {
    console.error('Error getting tokens:', err);
  }
  rl.close();
});
