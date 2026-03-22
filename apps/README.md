# WordWise Apps

This directory contains the client applications for WordWise.

## Applications

### [Mobile](./mobile/)

React Native mobile app for iOS and Android.

```bash
cd mobile
npm install
npx expo start --tunnel
```

**Tech Stack:**
- React Native + Expo
- React Navigation
- Zustand (state)
- FlashList (performant lists)
- Axios (API)

**Features:**
- Movie/Book vocabulary search
- Word lists with CEFR levels
- Offline support (coming soon)
- Saved words sync (coming soon)

## Shared Code

The mobile app uses shared types from `packages/types/` when running in monorepo mode.
For standalone development, types are duplicated in `mobile/src/types/`.

## Development

### Mobile App

See [mobile/README.md](./mobile/README.md) for detailed instructions.

Quick start:
```bash
cd mobile
npm install
npx expo start --tunnel
# Scan QR code with Expo Go app
```

### Web App

The web app is in the root `frontend/` directory (not in apps/).

```bash
cd ../frontend
npm install
npm run dev
```
