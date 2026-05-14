import React from 'react';
import { Image, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

export type SceneStripProps = {
  sceneNumber: string;   // e.g. "Scene 14"
  sceneTitle: string;    // e.g. "Interrogation room"
  timestamp: string;     // e.g. "01:24:30"
  imagePath: string;     // TMDB still/backdrop path
  wordsInScene: string[];
};

// TODO: wire up once the scenes endpoint returns
// { afterWord, sceneNumber, sceneTitle, timestamp, image_path, words_in_scene[] }
// per movie.
export const SceneStrip = ({ sceneNumber, sceneTitle, timestamp, imagePath, wordsInScene }: SceneStripProps) => (
  <View style={{ height: 84, width: '100%', overflow: 'hidden' }}>
    <Image
      source={{ uri: `https://image.tmdb.org/t/p/w780${imagePath}` }}
      style={{ position: 'absolute', width: '100%', height: '100%' }}
      resizeMode="cover"
    />
    <LinearGradient
      colors={['rgba(15,8,25,0.78)', 'rgba(15,8,25,0.55)', 'rgba(15,8,25,0.25)']}
      start={{ x: 0, y: 0.5 }}
      end={{ x: 1, y: 0.5 }}
      style={{ position: 'absolute', width: '100%', height: '100%' }}
    />
    <View style={{ paddingHorizontal: 16, paddingVertical: 12, flex: 1, justifyContent: 'center' }}>
      <Text style={{ fontSize: 10, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', color: 'rgba(255,255,255,0.65)', marginBottom: 2 }}>
        {sceneNumber.toUpperCase()} · {timestamp}
      </Text>
      <Text style={{ fontSize: 15, fontWeight: '700', color: '#FFFFFF', letterSpacing: -0.2, marginBottom: 4 }}>
        {sceneTitle}
      </Text>
      {wordsInScene.length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
          {wordsInScene.map((w, i) => (
            <View key={i} style={{ backgroundColor: 'rgba(255,255,255,0.16)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)', borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 }}>
              <Text style={{ fontSize: 10, fontWeight: '600', color: 'rgba(255,255,255,0.85)' }}>{w}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  </View>
);
