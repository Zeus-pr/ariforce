#!/bin/bash

# AriForce Railway Deployment Script
# Run this in VS Code terminal after logging in via Railway extension

set -e

echo "🚀 AriForce Railway Deployment Script"
echo "===================================="
echo ""

# Check if railway CLI is available
if ! command -v railway &> /dev/null; then
    echo "❌ Railway CLI not found. Please install it:"
    echo "   npm install -g @railway/cli"
    exit 1
fi

echo "✅ Railway CLI found"
echo ""

# Check if user is logged in
if ! railway whoami &> /dev/null; then
    echo "⚠️  Not logged in to Railway"
    echo "Please run: railway login"
    echo "Then run this script again"
    exit 1
fi

CURRENT_USER=$(railway whoami 2>/dev/null || echo "unknown")
echo "✅ Logged in as: $CURRENT_USER"
echo ""

# Initialize project
echo "📦 Initializing Railway project..."
if [ ! -f "railway.json" ]; then
    railway init --name "ariforce-production" --workspace "default" || true
fi

echo ""
echo "✅ Project initialized"
echo ""

# List projects
echo "📋 Existing Railway projects:"
railway projects || echo "No projects yet"
echo ""

echo "🎯 Next Steps:"
echo "1. Go to Railway dashboard: railway open"
echo "2. Create two services:"
echo "   a) API service:"
echo "      - Name: ariforce-api"
echo "      - Dockerfile: apps/api/Dockerfile"
echo "      - Port: 4000"
echo "      - Memory: 512MB"
echo ""
echo "   b) Web service:"
echo "      - Name: ariforce-web"
echo "      - Dockerfile: apps/web/Dockerfile"
echo "      - Port: 3000"
echo "      - Memory: 512MB"
echo ""
echo "3. Add PostgreSQL database:"
echo "   - Railway → + Add → PostgreSQL"
echo ""
echo "4. Set environment variables:"
echo "   API Service:"
echo "     NODE_ENV=production"
echo "     PORT=4000"
echo "     BETTER_AUTH_URL=<web-domain>"
echo "     CORS_ORIGINS=<web-domain>"
echo "     DATABASE_URL=<from PostgreSQL>"
echo ""
echo "   Web Service:"
echo "     NODE_ENV=production"
echo "     NEXT_PUBLIC_API_MODE=real"
echo "     NEXT_PUBLIC_API_BASE_URL=<api-domain>"
echo ""
echo "5. Deploy both services"
echo ""
echo "📖 Detailed guide: See RAILWAY-DEPLOYMENT.md"
echo "⚡ Quick start: See RAILWAY-QUICK-START.md"
echo ""
echo "🎉 Deployment ready! All Docker files and configs are in place."
