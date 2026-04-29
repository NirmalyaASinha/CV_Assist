# CV Assist (Node.js Only)

Simple dashboard prototype for students to upload CVs and discover opportunities.

## Run locally

1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the server:
   ```bash
   npm run dev
   ```
3. Open `http://localhost:3000`.

## Notes

- The upload route is a placeholder and will be wired to backend logic later.
- Company data is currently mocked in `server.js`.

## Google AI Studio (Gemini)

Set the following in `.env` to enable CV feedback:

```
GOOGLE_AI_KEY=
GOOGLE_AI_MODEL=gemini-2.5-flash
```

POST `http://localhost:3000/api/ai/feedback` with JSON:

```json
{ "text": "Paste CV text here" }
```
