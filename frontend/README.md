# FinSightIQ Frontend

Next.js UI for FinSightIQ’s document intelligence workflow.

## Screens

- `/login` and `/register`
- `/collections`
- `/collections/:collectionId`
- `/collections/:collectionId/compare`
- `/collections/:collectionId/contradictions`
- `/collections/:collectionId/documents/:documentId`
- `/collections/:collectionId/research`
- `/admin`

## Local setup

Create `frontend/.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:4000
NEXT_PUBLIC_WS_URL=ws://localhost:4000
```

Install and run:

```bash
npm install
npm run dev
```

Verify before committing:

```bash
npm run lint
npm run build
```

## Deployment variables

For Vercel or any hosted frontend:

```env
NEXT_PUBLIC_API_URL=https://your-backend-domain
NEXT_PUBLIC_WS_URL=wss://your-backend-domain
```

The backend must allow the deployed frontend origin through CORS.
