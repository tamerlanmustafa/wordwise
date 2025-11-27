# WordWise Deployment Guide

This guide will help you deploy WordWise with both frontend (GitHub Pages) and backend (Render.com).

---

## Architecture Overview

```
Frontend (GitHub Pages)              Backend (Render.com)
Static React App          →          FastAPI + PostgreSQL
https://yourdomain.com               https://wordwise-api.onrender.com
```

---

## Prerequisites

- GitHub account (you have this)
- Render.com account (free tier available)
- Google Cloud service account key (you have this)
- Custom domain (optional, but recommended for `/` base path)

---

## STEP 1: Deploy Backend to Render.com

### 1.1 Create PostgreSQL Database

1. Go to [render.com](https://render.com) and sign up/login
2. Click **"New"** → **"PostgreSQL"**
3. Settings:
   - **Name**: `wordwise-db`
   - **Database**: `wordwise_db`
   - **User**: `wordwise_user`
   - **Region**: Choose closest to you
   - **Plan**: Free
4. Click **"Create Database"**
5. **COPY** the **"Internal Database URL"** (looks like `postgresql://wordwise_user:...@...`)

### 1.2 Deploy Backend Service

1. Click **"New"** → **"Web Service"**
2. Connect your GitHub: `tamerlanmustafa/wordwise`
3. Settings:
   - **Name**: `wordwise-backend`
   - **Region**: Same as database
   - **Branch**: `main`
   - **Root Directory**: `backend`
   - **Runtime**: `Python 3`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `uvicorn src.main:app --host 0.0.0.0 --port $PORT`
   - **Plan**: Free

4. Click **"Create Web Service"**

### 1.3 Configure Environment Variables

In your Render backend service dashboard:

1. Go to **"Environment"** tab
2. Add these environment variables:

```bash
DATABASE_URL=<paste-your-internal-database-url-from-step-1.1>
GOOGLE_APPLICATION_CREDENTIALS=/etc/secrets/google_service.json
ENVIRONMENT=production
```

### 1.4 Add Google Service Account Key

1. Still in **"Environment"** tab
2. Scroll to **"Secret Files"**
3. Click **"Add Secret File"**
   - **Filename**: `google_service.json`
   - **Contents**: Paste your entire Google service account JSON key
4. Click **"Save Changes"**

### 1.5 Get Your Backend URL

After deployment completes (5-10 minutes):
- Your backend URL will be: `https://wordwise-backend.onrender.com`
- Test it: Visit `https://wordwise-backend.onrender.com/docs` (FastAPI docs)

**IMPORTANT**: Copy this URL, you'll need it for frontend configuration.

---

## STEP 2: Configure GitHub Secrets

Your frontend needs to know where the backend is. Add secrets to GitHub:

1. Go to your GitHub repo: `https://github.com/tamerlanmustafa/wordwise`
2. Click **Settings** → **Secrets and variables** → **Actions**
3. Click **"New repository secret"** for each:

```bash
# Secret Name: VITE_API_URL
# Value: https://wordwise-backend.onrender.com

# Secret Name: VITE_GOOGLE_CLIENT_ID
# Value: 400446242104-gvfqp0soikdji99132k59nlh88moucpt.apps.googleusercontent.com

# Secret Name: VITE_TMDB_API_KEY
# Value: 9dece7a38786ac0c58794d6db4af3d51
```

---

## STEP 3: Configure Google OAuth for Production

Your OAuth needs to allow the production URL:

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Navigate to **APIs & Services** → **Credentials**
3. Find your OAuth 2.0 Client ID
4. Add **Authorized JavaScript origins**:
   - `https://tamerlanmustafa.github.io`
   - `https://yourdomain.com` (if using custom domain)
5. Add **Authorized redirect URIs**:
   - `https://tamerlanmustafa.github.io/wordwise`
   - `https://yourdomain.com` (if using custom domain)
6. Click **"Save"**

---

## STEP 4: Configure Base Path

You have **two options** for the URL structure:

### Option A: Use Custom Domain (Recommended - gives you `/` path)

1. Update `frontend/vite.config.ts`:
   ```typescript
   base: '/',  // Change from '/wordwise/'
   ```

2. In GitHub: **Settings** → **Pages** → **Custom domain**
   - Enter your domain: `wordwise.yourdomain.com`
   - Click **"Save"**

3. In your domain DNS settings, add CNAME record:
   ```
   wordwise  CNAME  tamerlanmustafa.github.io
   ```

4. Your site will be: `https://wordwise.yourdomain.com/`

### Option B: Keep GitHub Pages Subdirectory (Current setup)

- Keep `base: '/wordwise/'` in vite.config.ts
- Your site will be: `https://tamerlanmustafa.github.io/wordwise/`
- Home page will be at `/wordwise/` not `/`

**If you want `/` for home page, you MUST use Option A (custom domain)**

---

## STEP 5: Deploy Frontend

Once backend is deployed and secrets are configured:

1. Push to main branch (or manually trigger workflow):
   ```bash
   git push origin main
   ```

2. Watch deployment:
   - Go to **Actions** tab in GitHub
   - You should see two jobs: `build` and `deploy`
   - Wait for both to complete (~5 minutes)

3. Your frontend will be live at:
   - **Without custom domain**: `https://tamerlanmustafa.github.io/wordwise/`
   - **With custom domain**: `https://yourdomain.com/`

---

## STEP 6: Verify Deployment

### Check Frontend
- Visit your GitHub Pages URL
- Open browser DevTools → Network tab
- Verify API requests go to your Render backend URL

### Check Backend
- Visit `https://wordwise-backend.onrender.com/docs`
- Should see FastAPI documentation
- Try: `https://wordwise-backend.onrender.com/api/health` (should return `{"status":"ok"}`)

### Check Database Connection
- In Render dashboard → your backend service → Logs
- Should NOT see database connection errors

---

## Common Issues & Solutions

### Issue 1: Frontend shows "Network Error" or "Cannot connect to backend"

**Solution**:
- Check GitHub Secrets are set correctly
- Verify backend URL in Render dashboard
- Check backend logs for errors
- Ensure CORS is configured in backend to allow your frontend domain

### Issue 2: Backend shows "Database connection failed"

**Solution**:
- Verify `DATABASE_URL` environment variable in Render
- Ensure database and backend are in same region
- Check database is running (Render dashboard)

### Issue 3: Google OAuth doesn't work

**Solution**:
- Add production URLs to Google Cloud Console authorized origins/redirects
- Clear browser cache
- Check `VITE_GOOGLE_CLIENT_ID` secret is set in GitHub

### Issue 4: "403 Forbidden" when deploying to GitHub Pages

**Solution**:
- Check workflow permissions in `.github/workflows/deploy.yml`
- Ensure `pages: write` and `id-token: write` are set

### Issue 5: Assets not loading (404 errors)

**Solution**:
- Verify `base` path in `vite.config.ts` matches your deployment URL
- If using `/wordwise/`, all routes must use this base
- If using custom domain, use `base: '/'`

---

## Monitoring & Maintenance

### Backend Logs (Render)
- Dashboard → your service → **Logs** tab
- Real-time logs for debugging

### Frontend Logs (Browser)
- Open DevTools → Console
- Check for API errors

### Database (Render)
- Dashboard → PostgreSQL → **Metrics** tab
- Monitor connections, queries, storage

### Free Tier Limits (Render)
- Backend sleeps after 15 minutes of inactivity
- First request after sleep takes ~30 seconds
- 750 hours/month free (enough for one always-on service)
- Database: 1GB storage, shared CPU

---

## Updating After Initial Deployment

### Frontend Updates
- Just push to `main` branch
- GitHub Actions automatically rebuilds and deploys

### Backend Updates
- Push to `main` branch
- Render automatically rebuilds and redeploys

### Database Migrations
- SSH into Render backend (or use Render shell)
- Run: `alembic upgrade head`

---

## Cost Optimization

### Current Free Setup
- **GitHub Pages**: Free (static hosting)
- **Render Backend**: Free tier with sleep
- **Render Database**: Free tier 1GB
- **Total**: $0/month

### Upgrade Options (if needed)
- **Render Starter ($7/month)**: No sleep, more resources
- **Render Standard ($25/month)**: Production-ready
- **Custom Domain**: ~$10-15/year

---

## Security Checklist

- ✅ Google service account key is in Render secret files (not in code)
- ✅ `.env` files are gitignored
- ✅ Backend uses environment variables for sensitive data
- ✅ OAuth credentials configured for production URLs
- ✅ Database password is secure (generated by Render)
- ✅ HTTPS enabled on both frontend and backend

---

## Next Steps

1. **Set up monitoring**: Add Sentry or similar for error tracking
2. **Add CI/CD tests**: Run tests before deployment
3. **Set up staging environment**: Test before production
4. **Configure CDN**: Use Cloudflare for better performance
5. **Add database backups**: Render has automatic backups on paid plans

---

## Support & Resources

- **Render Docs**: https://render.com/docs
- **GitHub Pages**: https://docs.github.com/en/pages
- **Vite Deployment**: https://vitejs.dev/guide/static-deploy.html
- **FastAPI Deployment**: https://fastapi.tiangolo.com/deployment/

---

**You're all set!** 🚀

Once you complete these steps, your WordWise app will be fully deployed and accessible to users worldwide.
