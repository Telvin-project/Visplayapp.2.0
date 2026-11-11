import React, { useEffect } from 'react';
import { AppState, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';

interface Props {
  title: string;
  previewUrl: string;
  onClose: () => void;
}

/** Public 300-second preview only; server independently checks media readiness and publication. */
export function NativePreview({ title, previewUrl, onClose }: Props) {
  const player = useVideoPlayer({ uri: previewUrl, useCaching: false }, nativePlayer => {
    nativePlayer.loop = false;
  });

  useEffect(() => {
    player.play();
    const subscription = AppState.addEventListener('change', next => {
      if (next !== 'active') player.pause();
    });
    return () => {
      subscription.remove();
      player.pause();
    };
  }, [player]);

  return (
    <Modal visible animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen">
      <View style={styles.screen}>
        <View style={styles.heading}>
          <Text style={styles.headingText} numberOfLines={2}>{title}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close native preview"
            style={styles.closeButton}
            onPress={onClose}
          >
            <Text style={styles.closeText}>Close ✕</Text>
          </Pressable>
        </View>
        <View style={styles.playerFrame}>
          <VideoView
            style={styles.player}
            player={player}
            nativeControls
            allowsFullscreen
            contentFit="contain"
          />
        </View>
        <Text style={styles.note}>
          Free preview only (up to 5 minutes). Full films remain protected by the server and are not downloaded to this device.
        </Text>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center', backgroundColor: '#07090E', padding: 20 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 24 },
  headingText: { flex: 1, color: '#F2F6FF', fontSize: 17, fontWeight: '700' },
  closeButton: { backgroundColor: '#172032', borderRadius: 12, minHeight: 48, paddingHorizontal: 16, justifyContent: 'center' },
  closeText: { color: '#C9E5F0', fontSize: 14, fontWeight: '700' },
  playerFrame: { backgroundColor: '#010204', borderRadius: 18, overflow: 'hidden', aspectRatio: 16 / 9 },
  player: { width: '100%', height: '100%' },
  note: { color: '#A9B4C8', fontSize: 13, lineHeight: 19, marginTop: 24, textAlign: 'center' },
});
