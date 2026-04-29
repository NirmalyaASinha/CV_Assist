# CV Assist

CV Assist is an Express.js app for students to upload a CV, detect their likely domain, discover ranked company matches, and get AI-powered resume guidance.

## What It Does

- Uploads CV files from the landing page
- Extracts text from:
  - PDF files using `pdf-parse`
  - DOCX files using `unzip`
  - TXT and Markdown files directly
- Detects domain fit and keywords from the uploaded CV
- Ranks matching companies and roles
- Lets users filter matches by search, location, status, and sort mode
- Opens company details in a modal view
- Generates AI feedback for CV improvement

## Tech Stack

- Node.js
- Express
- EJS
- MongoDB
- Multer
- `pdf-parse`
- Google AI Studio / Gemini API

## Project Structure

```text
.
├── server.js
├── public/
│   ├── app.js
│   ├── styles.css
│   └── assets/
├── views/
│   ├── index.ejs
│   ├── results.ejs
│   └── dashboard.ejs
├── lib/
│   └── matching.js
├── scripts/
│   ├── import-excel-mongo.js
│   ├── import-excel.js
│   └── check-neon.js
└── vercel.json
```

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Create a `.env` file with the values you need:

```env
MONGODB_URI=
MONGODB_DB_NAME=cv_assist
GOOGLE_AI_KEY=
GOOGLE_AI_MODEL=gemini-2.5-flash
DATABASE_URL=
NEON_DATABASE_URL=
```

Notes:

- `MONGODB_URI` is the primary database connection used by the app.
- `DATABASE_URL` and `NEON_DATABASE_URL` are still read for compatibility in parts of the existing code.
- If `GOOGLE_AI_KEY` is missing, the app falls back to a heuristic domain analysis path.

3. Start the app:

```bash
npm run dev
```

4. Open:

```text
http://localhost:3000
```

## Available Scripts

```bash
npm run dev
npm start
npm run db:check
npm run db:import
npm run db:import:mongo
```

## Upload and Parsing Behavior

- PDF uploads are parsed in Node using `pdf-parse`
- DOCX uploads are unpacked and read from `word/document.xml`
- TXT and Markdown uploads are read directly as text
- Legacy `.doc` files are not supported

## AI Feedback Endpoint

You can request CV suggestions directly through the API:

```bash
POST /api/ai/feedback
Content-Type: application/json
```

Example payload:

```json
{
  "text": "Paste CV text here"
}
```

## Deployment Notes

- The app is configured for Vercel with `vercel.json`
- `server.js` exports the Express app for serverless deployment
- Local `app.listen(...)` only runs outside production
- PDF parsing is Vercel-safe and does not rely on `pdfjs-dist`, `DOMMatrix`, or native canvas dependencies

## Current Experience

- Landing page with CV upload and job search prompt
- Results dashboard with:
  - CV analysis summary
  - keyword and role chips
  - ranked opportunity cards
  - filter bar and summary stats
  - company detail modal
  - AI feedback modal

## Notes

- Some unrelated local UI edits may still exist in the working tree while developing
- Company ranking depends on the imported dataset and CV analysis quality
- If MongoDB is unavailable, parts of the app fall back to reduced behavior
