# EconSpeak Lecture Transcriber

A browser-based lecture transcription and analysis tool for finance and business topics. Offers real-time recording or file uploads, automatic transcription via Scribe, audio visualization, term/event extraction with DeepSeek, and in-page note taking.

## Features

- Real-time or file-based audio transcription using `scribe_v1`
- Audio visualizer (realtime bars + file amplitude view)
- Automatic correction of transcript chunks (punctuation, spelling)
- Extraction and highlighting of economic terms and historical events
- Sidebar cards for detected terms/events with click-to-highlight
- Resizable transcription/notes panes and copy-to-clipboard
- Language selection and error/status indicators

## Directory Structure

```
.
├── api
│   ├── transcribe.js        # Serverless endpoint for speech-to-text
│   └── deepseek.js         # Serverless endpoint for term/event extraction
├── public
│   ├── index.html          # Main UI
│   ├── script.js           # App logic (recording, transcription, UI)
│   ├── audio.js            # Audio visualizer module
│   └── styles.css          # Styles and layout
├── .gitignore
├── package.json
└── README.md
```

## Prerequisites

- Node.js >=14
- npm (or Yarn)
- A Vercel account (mandatory for storage of API keys)
- Modern browser (Chrome, Firefox, Edge)

## Environment Variables

On Vercel, set the following environment variables to store your AI keys:

- `ELEVENLABS_API_KEY`: Your ElevenLabs AI key
- `DEEPSEEK_API_KEY`: Your DeepSeek AI key
  To configure these keys on Vercel and locally, follow these steps:

1. In the Vercel Dashboard
    - Select your project, go to **Settings → Environment Variables**
    - Click **Add** and enter:
        - Name: `ELEVENLABS_API_KEY`
        - Value: _your ElevenLabs key_
        - Environment: _Development, Preview, Production_ (as needed)
    - Repeat for `DEEPSEEK_API_KEY`

2. Using the Vercel CLI
   ```bash
   vercel env add ELEVENLABS_API_KEY production
   vercel env add DEEPSEEK_API_KEY production
   ```
   To verify:
   ```bash
   vercel env ls
   ```

3. Pull variables into a local `.env.local`
   ```bash
   vercel env pull .env.local
   ```

4. Add `.env.local` to `.gitignore`

5. In your app, read them via `process.env` (e.g., in Next.js or Node):
   ```javascript
   const elevenlabsKey = process.env.ELEVENLABS_API_KEY;
   const deepseekKey   = process.env.DEEPSEEK_API_KEY;
   ```  

6. (Optional) Commit a template file `.env.example`:
   ```bash
   ELEVENLABS_API_KEY=
   DEEPSEEK_API_KEY=
   ```

## Install & Development

```bash
npm install
npm run dev
```

- Starts a local server (e.g. `http://localhost:3000`)
- Auto-reload on file changes

## Build & Production

```bash
npm run build
npm start
```

- `build` bundles serverless functions and static assets
- `start` launches production server

## Deployment

### Vercel

1. Install Vercel CLI:
   ```bash
   npm install -g vercel
   ```
2. Deploy:
   ```bash
   vercel
   ```
3. Follow interactive prompts (project name, scope)

### Custom Host

- Copy `/public` contents to any static host
- Deploy `api` endpoints on Node-capable server (e.g. Express, Serverless)

## Usage

1. Open the app in your browser.
2. Grant microphone permission.
3. Click **Start Recording** or **Transcribe files**.
4. View live transcript, detected terms/events, and add notes.
5. Click term/event cards to jump to highlights.

## TODO

- [ ] Persist notes to localStorage or backend
- [ ] User authentication and transcript management
- [ ] Export transcript and notes (PDF, DOCX)
- [ ] Improve mobile layout and touch support
- [ ] Dark mode / theming
- [ ] Additional language support and offline transcription
- [ ] Accessibility enhancements (ARIA, keyboard navigation)