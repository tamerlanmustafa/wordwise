# WordWise Mobile

React Native mobile app for WordWise - learn vocabulary from movies and books.

## Quick Start

### Prerequisites
- Node.js 20+
- npm or yarn
- Expo Go app on your phone (from Play Store / App Store)
- Python 3.10+ (for backend)

### Development Setup (WSL2 + Physical Device)

If you're developing on WSL2 and testing on a physical Android device, follow these steps:

#### One-time Setup

1. **Set up port forwarding** (run in Windows PowerShell as Administrator):
   ```powershell
   # Get your WSL IP first (run in WSL): hostname -I | awk '{print $1}'
   # Then set up port forwarding (replace WSL_IP with your actual IP):
   netsh interface portproxy add v4tov4 listenport=8000 listenaddress=0.0.0.0 connectport=8000 connectaddress=WSL_IP

   # Add firewall rule
   netsh advfirewall firewall add rule name="WSL Backend 8000" dir=in action=allow protocol=TCP localport=8000
   ```

2. **Update API URL** in `src/config/env.ts`:
   ```typescript
   // Find your Windows WiFi IP: ipconfig (look for "Wireless LAN adapter Wi-Fi" IPv4)
   development: {
     API_URL: 'http://YOUR_WINDOWS_IP:8000',
   },
   ```

#### Starting Development

**Terminal 1 - Backend:**
```bash
cd ~/projects/wordwise/backend
uvicorn src.main:app --reload --host 0.0.0.0 --port 8000
```

**Terminal 2 - Expo:**
```bash
cd ~/projects/wordwise/apps/mobile
npx expo start
```

Then scan the QR code with Expo Go on your phone.

#### Alternative: Combined Command

```bash
cd ~/projects/wordwise/apps/mobile
npm run start:full
```

Note: With `start:full`, you won't see the QR code. Open Expo Go and your project should appear under "Development servers".

### Emulator Setup

For Android Emulator (no port forwarding needed), update `src/config/env.ts`:
```typescript
development: {
  API_URL: 'http://10.0.2.2:8000',  // Android emulator -> host localhost
},
```

## Project Structure

```
src/
├── app/                  # App entry point & error boundary
│   ├── App.tsx
│   └── ErrorBoundary.tsx
├── components/           # Shared UI components
│   └── LoadingScreen.tsx
├── config/               # Environment configuration
│   └── env.ts
├── features/             # Feature modules
│   ├── auth/             # Authentication
│   │   └── screens/
│   │       └── LoginScreen.tsx
│   ├── movies/           # Movie search & details
│   │   ├── components/
│   │   │   └── MovieCard.tsx
│   │   ├── hooks/
│   │   │   └── useMovieSearch.ts
│   │   └── screens/
│   │       └── MovieSearchScreen.tsx
│   ├── vocabulary/       # Word lists
│   │   ├── components/
│   │   │   └── WordRow.tsx
│   │   ├── hooks/
│   │   │   └── useVocabulary.ts
│   │   └── screens/
│   │       └── WordListScreen.tsx
│   └── settings/         # User settings
├── navigation/           # React Navigation config
│   ├── types.ts
│   ├── AuthNavigator.tsx
│   ├── MainNavigator.tsx
│   └── RootNavigator.tsx
├── services/             # External services
│   ├── api/              # API client
│   │   └── client.ts
│   ├── auth/             # Token storage
│   │   └── tokenStorage.ts
│   └── db/               # Local database
│       └── database.ts
├── stores/               # Zustand state stores
│   └── authStore.ts
├── theme/                # Styling constants
│   └── index.ts
├── types/                # TypeScript types
│   └── index.ts
└── utils/                # Helper functions
```

## Tech Stack

| Category | Library |
|----------|---------|
| Framework | React Native + Expo |
| Navigation | React Navigation 7 |
| State | Zustand |
| Lists | FlashList |
| API | Axios |
| Storage | AsyncStorage + SecureStore |

## Available Scripts

```bash
# Start Metro bundler
npm start

# Start with Expo
npx expo start

# Start with tunnel (for WSL2/remote testing)
npx expo start --tunnel

# Run on Android (requires Android SDK)
npm run android

# Run on iOS (macOS only)
npm run ios

# Run tests
npm test

# Lint code
npm run lint
```

## Development

### Environment Configuration

Edit `src/config/env.ts` to change API URLs:

```typescript
const configs = {
  development: {
    API_URL: 'http://10.0.2.2:8000',  // Android emulator
  },
  staging: {
    API_URL: 'https://staging-api.wordwise.app',
  },
  production: {
    API_URL: 'https://api.wordwise.app',
  },
};
```

### Adding a New Feature

1. Create feature folder: `src/features/[feature-name]/`
2. Add screens, components, hooks as needed
3. Add navigation in `src/navigation/MainNavigator.tsx`
4. Update types in `src/navigation/types.ts`

### API Integration

The API client is in `src/services/api/client.ts`. Add new endpoints:

```typescript
class ApiClient {
  async getNewData(id: number): Promise<DataType> {
    const { data } = await this.axios.get(`/api/endpoint/${id}`);
    return data;
  }
}
```

## Building for Production

### Android APK

```bash
# Using EAS Build
npx eas build --platform android --profile preview
```

### iOS

```bash
# Using EAS Build (requires Apple Developer account)
npx eas build --platform ios --profile preview
```

## Troubleshooting

### Common Issues

**Metro bundler not starting:**
```bash
npx expo start --clear
```

**Expo Go can't connect:**
```bash
# Use tunnel mode
npx expo start --tunnel
```

**Module not found errors:**
```bash
rm -rf node_modules
npm install
npx expo start --clear
```

## Next Steps

1. [x] Implement Google OAuth
2. [ ] Add vocabulary download for offline access
3. [ ] Build saved words with sync
4. [ ] Add translation caching
5. [ ] Implement offline search
