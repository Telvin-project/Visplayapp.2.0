import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, BackHandler, Image, Pressable, ScrollView, Share,
  StatusBar, StyleSheet, Text, View,
} from 'react-native';
import * as Linking from 'expo-linking';
import * as SecureStore from 'expo-secure-store';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import WebView, { type WebViewMessageEvent, type WebViewNavigation } from 'react-native-webview';
import { NativePreview } from './components/NativePreview';
import {
  addSavedFilm, isAllowedReaderNavigation, parseNativeMessage,
  parseReaderConfig, parseReaderDeepLink, parseSavedFilms, publicPreviewUrl,
} from './security/navigation.mjs';
import type { ReaderDeepLink, SavedFilm } from './security/navigation.mjs';

const SAVED_KEY = 'visplay_reader_saved_public_movies_v1';
type Tab = 'explore' | 'saved' | 'settings';
type ActivePreview = { title: string; url: string };
type WebDestination = { view: 'home' | 'bundles' | 'creators' | 'library' | 'profile' } | { view: 'watch'; movieId: string };

/** Expo public env vars are embedded at build time. Never put secrets here. */
const CONFIGURED_URL = process.env.EXPO_PUBLIC_VISPLAY_READER_URL;

function NavButton({ selected, label, onPress }: { selected: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={`${label} tab`}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.navButton, selected && styles.navButtonActive]}
    >
      <Text style={[styles.navText, selected && styles.navTextActive]}>{label}</Text>
    </Pressable>
  );
}

function ReaderApp() {
  const insets = useSafeAreaInsets();
  const config = useMemo(() => parseReaderConfig(CONFIGURED_URL), []);
  const webRef = useRef<WebView>(null);
  const [tab, setTab] = useState<Tab>('explore');
  const [canGoBack, setCanGoBack] = useState(false);
  const [webLoading, setWebLoading] = useState(true);
  const [webError, setWebError] = useState(false);
  const [blockedNavigation, setBlockedNavigation] = useState(false);
  const [saved, setSaved] = useState<SavedFilm[]>([]);
  const [savedReady, setSavedReady] = useState(false);
  const savedRef = useRef<SavedFilm[]>([]);
  const [preview, setPreview] = useState<ActivePreview | null>(null);

  useEffect(() => {
    let active = true;
    SecureStore.getItemAsync(SAVED_KEY)
      .then(value => {
        if (!active) return;
        const next = parseSavedFilms(value ?? '[]');
        savedRef.current = next;
        setSaved(next);
      })
      .catch(() => {
        // A corrupt or inaccessible local bookmark store never grants content access.
        if (active) Alert.alert('Saved list unavailable', 'This device could not open your locally saved movie list. Your VisPlay account is unaffected.');
      })
      .finally(() => { if (active) setSavedReady(true); });
    return () => { active = false; };
  }, []);

  const persistSaved = useCallback(async (next: SavedFilm[]) => {
    try {
      await SecureStore.setItemAsync(SAVED_KEY, JSON.stringify(next));
      savedRef.current = next;
      setSaved(next);
      return true;
    } catch {
      Alert.alert('Cannot save on this device', 'Local device storage is unavailable. Please retry later.');
      return false;
    }
  }, []);

  const navigateWeb = useCallback((destination: WebDestination) => {
    // The destination consists entirely of hardcoded view names and validated movie IDs.
    // Never interpolate a remote URL, token, script body or unsanitized text here.
    const detail = JSON.stringify(destination);
    webRef.current?.injectJavaScript(
      `window.dispatchEvent(new CustomEvent('visplay-native:navigate', { detail: ${detail} })); true;`
    );
    setTab('explore');
  }, []);

  const handleDeepLink = useCallback((url: string | null) => {
    const destination: ReaderDeepLink | null = parseReaderDeepLink(url);
    if (!destination) return;
    if (destination.type === 'saved') setTab('saved');
    else if (destination.type === 'settings') setTab('settings');
    else navigateWeb({ view: 'watch', movieId: destination.movieId });
  }, [navigateWeb]);

  useEffect(() => {
    let active = true;
    Linking.getInitialURL().then(url => { if (active) handleDeepLink(url); }).catch(() => {});
    const listener = Linking.addEventListener('url', event => handleDeepLink(event.url));
    return () => { active = false; listener.remove(); };
  }, [handleDeepLink]);

  const onWebMessage = useCallback(async (event: WebViewMessageEvent) => {
    if (!config || !isAllowedReaderNavigation(event.nativeEvent.url, config.origin)) return;
    const message = parseNativeMessage(event.nativeEvent.data);
    if (!message) return;
    if (message.type === 'OPEN_PREVIEW') {
      const url = publicPreviewUrl(config.origin, message.movieId);
      if (url) setPreview({ url, title: message.title });
    } else if (savedReady) {
      const next = addSavedFilm(savedRef.current, message);
      if (await persistSaved(next)) {
        Alert.alert('Saved on this device', 'Added to Saved. This is a bookmark, not an offline movie download.');
      }
    }
  }, [config, persistSaved, savedReady]);

  useEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      if (preview) { setPreview(null); return true; }
      if (tab !== 'explore') { setTab('explore'); return true; }
      if (canGoBack) { webRef.current?.goBack(); return true; }
      return false;
    });
    return () => listener.remove();
  }, [preview, tab, canGoBack]);

  const reviewWebNavigation = useCallback((navigation: WebViewNavigation) => {
    if (!config) return;
    if (!isAllowedReaderNavigation(navigation.url, config.origin)) {
      webRef.current?.stopLoading();
      if (navigation.canGoBack) webRef.current?.goBack();
      setBlockedNavigation(true);
      return;
    }
    setCanGoBack(navigation.canGoBack);
  }, [config]);

  const shareSaved = useCallback(async (movieId: string) => {
    if (!config) return;
    // Only a non-commercial reader link; no web checkout path or purchase prompt.
    try { await Share.share({ message: `${config.origin}/reader?watch=${encodeURIComponent(movieId)}` }); }
    catch { Alert.alert('Share unavailable', 'Your device could not open its share sheet.'); }
  }, [config]);

  if (!config) {
    return (
      <View style={[styles.configurationError, { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 32 }]}>
        <Text style={styles.errorHeading}>VisPlay staging address required</Text>
        <Text style={styles.bodyText}>
          The app will not connect to an unknown or insecure website. Ask your engineer to set EXPO_PUBLIC_VISPLAY_READER_URL to the approved HTTPS site ending in /reader, then rebuild the app.
        </Text>
        <Text style={styles.bodyText}>No user information has been sent.</Text>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <StatusBar barStyle="light-content" backgroundColor="#07090E" />
      <View style={styles.topBar}>
        <Image source={require('./assets/icon.png')} style={styles.logo} accessibilityLabel="VisPlay logo" />
        <View style={styles.brandText}>
          <Text style={styles.brand}>VISPLAY <Text style={styles.brandAccent}>READER</Text></Text>
          <Text style={styles.brandSubtitle}>Your movies. Your account.</Text>
        </View>
        <View style={styles.readerBadge}><Text style={styles.readerBadgeText}>NO CHECKOUT</Text></View>
      </View>

      {blockedNavigation && (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>A link was blocked to keep this app in the reader experience.</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Dismiss blocked link notice" onPress={() => setBlockedNavigation(false)}>
            <Text style={styles.noticeDismiss}>Dismiss</Text>
          </Pressable>
        </View>
      )}

      {/* The reader stays mounted across native tab switches, preserving the browser's HttpOnly session cookie.
          No browser session, Supabase credential, or JWT is copied into React Native. */}
      <View style={[styles.readerFrame, tab !== 'explore' && styles.hiddenFrame]} pointerEvents={tab === 'explore' ? 'auto' : 'none'}>
        <WebView
          ref={webRef}
          source={{ uri: config.readerUrl }}
          originWhitelist={[config.origin]}
          onShouldStartLoadWithRequest={request => isAllowedReaderNavigation(request.url, config.origin)}
          onNavigationStateChange={reviewWebNavigation}
          onMessage={onWebMessage}
          onOpenWindow={() => setBlockedNavigation(true)}
          onFileDownload={() => setBlockedNavigation(true)}
          onError={() => { setWebError(true); setWebLoading(false); }}
          onHttpError={({ nativeEvent }) => {
            if (nativeEvent.statusCode >= 500 && isAllowedReaderNavigation(nativeEvent.url, config.origin)) {
              setWebError(true);
            }
          }}
          onLoadStart={() => { setWebLoading(true); setWebError(false); }}
          onLoadEnd={() => setWebLoading(false)}
          setSupportMultipleWindows={false}
          javaScriptEnabled
          javaScriptCanOpenWindowsAutomatically={false}
          sharedCookiesEnabled
          thirdPartyCookiesEnabled={false}
          allowFileAccess={false}
          allowFileAccessFromFileURLs={false}
          allowUniversalAccessFromFileURLs={false}
          mixedContentMode="never"
          cacheEnabled={false}
          incognito={false}
          allowsInlineMediaPlayback
          allowsFullscreenVideo
          mediaPlaybackRequiresUserAction
          style={styles.webview}
        />
        {webLoading && !webError && (
          <View style={styles.loading} pointerEvents="none">
            <ActivityIndicator color="#3FD9E9" size="large" />
            <Text style={styles.loadingLabel}>Opening your reader…</Text>
          </View>
        )}
        {webError && (
          <View style={styles.loadError}>
            <Text style={styles.errorHeading}>Can't load the reader</Text>
            <Text style={styles.bodyText}>Check your internet connection or ask whether the staging site is online. Your saved bookmarks are still available.</Text>
            <Pressable accessibilityRole="button" style={styles.primaryButton} onPress={() => { setWebError(false); setWebLoading(true); webRef.current?.reload(); }}>
              <Text style={styles.primaryButtonText}>Try again</Text>
            </Pressable>
          </View>
        )}
      </View>

      {tab === 'saved' && (
        <ScrollView style={styles.page} contentContainerStyle={styles.pageContent}>
          <Text style={styles.pageHeading}>Saved on this device</Text>
          <Text style={styles.pageDescription}>Keep a short reading list of films you want to return to. These are bookmarks, not offline downloads or proof of a purchase.</Text>
          {!savedReady ? <ActivityIndicator color="#3FD9E9" /> : saved.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.cardTitle}>Your list is empty</Text>
              <Text style={styles.bodyText}>Open a film in Explore and tap “Save to this device”.</Text>
              <Pressable accessibilityRole="button" style={styles.secondaryButton} onPress={() => setTab('explore')}>
                <Text style={styles.secondaryButtonText}>Browse movies</Text>
              </Pressable>
            </View>
          ) : saved.map(item => (
            <View key={item.movieId} style={styles.savedCard}>
              <Text style={styles.cardTitle}>{item.title}</Text>
              <View style={styles.actionRow}>
                <Pressable accessibilityRole="button" style={styles.smallButton} onPress={() => navigateWeb({ view: 'watch', movieId: item.movieId })}>
                  <Text style={styles.smallButtonText}>Open film</Text>
                </Pressable>
                <Pressable accessibilityRole="button" style={styles.smallButton} onPress={() => shareSaved(item.movieId)}>
                  <Text style={styles.smallButtonText}>Share</Text>
                </Pressable>
                <Pressable accessibilityRole="button" style={styles.dangerButton} onPress={() => void persistSaved(savedRef.current.filter(film => film.movieId !== item.movieId))}>
                  <Text style={styles.dangerText}>Remove</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </ScrollView>
      )}

      {tab === 'settings' && (
        <ScrollView style={styles.page} contentContainerStyle={styles.pageContent}>
          <Text style={styles.pageHeading}>Reader settings</Text>
          <Text style={styles.pageDescription}>View films already available to your account and manage account security in the trusted VisPlay reader. Your sign-in details stay in the secured web session.</Text>
          <View style={styles.settingsCard}>
            <Text style={styles.cardTitle}>Your account</Text>
            <Pressable accessibilityRole="button" style={styles.settingLink} onPress={() => navigateWeb({ view: 'library' })}>
              <Text style={styles.settingLinkText}>Open my library</Text><Text style={styles.settingArrow}>›</Text>
            </Pressable>
            <Pressable accessibilityRole="button" style={styles.settingLink} onPress={() => navigateWeb({ view: 'profile' })}>
              <Text style={styles.settingLinkText}>Account settings / Delete account</Text><Text style={styles.settingArrow}>›</Text>
            </Pressable>
            <Text style={styles.bodyText}>For account deletion: sign in, open Settings, choose Delete Account, then follow the on-screen confirmation. Accounts holding funds or unsettled payouts cannot be deleted by forfeiting money.</Text>
          </View>
          <View style={styles.settingsCard}>
            <Text style={styles.cardTitle}>About this reader</Text>
            <Text style={styles.bodyText}>This app provides film discovery, native five-minute previews, bookmarks, and playback of films you already have access to. There is no in-app checkout or link prompting you to pay elsewhere.</Text>
            <Text style={styles.bodyText}>Native Google sign-in is not active pending a secure system-browser integration. Use verified email sign-in for testing.</Text>
            <Text style={styles.versionText}>VisPlay Reader · Source preview 0.1.0 · Staging only</Text>
          </View>
        </ScrollView>
      )}

      <View style={styles.tabBar} accessibilityRole="tablist">
        <NavButton label="Explore" selected={tab === 'explore'} onPress={() => { navigateWeb({ view: 'home' }); }} />
        <NavButton label={`Saved (${saved.length})`} selected={tab === 'saved'} onPress={() => setTab('saved')} />
        <NavButton label="Settings" selected={tab === 'settings'} onPress={() => setTab('settings')} />
      </View>

      {preview && <NativePreview title={preview.title} previewUrl={preview.url} onClose={() => setPreview(null)} />}
    </View>
  );
}

export default function App() {
  return <SafeAreaProvider><ReaderApp /></SafeAreaProvider>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#07090E' },
  configurationError: { flex: 1, backgroundColor: '#07090E', paddingHorizontal: 28, justifyContent: 'center', gap: 20 },
  topBar: { minHeight: 62, backgroundColor: '#090E19', borderBottomWidth: 1, borderBottomColor: '#263246', paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 9 },
  logo: { width: 39, height: 39, borderRadius: 9 },
  brandText: { flex: 1 },
  brand: { color: '#F2F6FF', fontSize: 15, fontWeight: '900', letterSpacing: 1.2 },
  brandAccent: { color: '#3FD9E9', fontSize: 11, fontWeight: '800' },
  brandSubtitle: { color: '#92A3B9', fontSize: 11, marginTop: 3 },
  readerBadge: { paddingVertical: 6, paddingHorizontal: 8, borderRadius: 9, backgroundColor: '#17303B', borderWidth: 1, borderColor: '#245D65' },
  readerBadgeText: { color: '#80E6EE', fontWeight: '800', fontSize: 9, letterSpacing: 0.5 },
  notice: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#29301A', borderBottomWidth: 1, borderBottomColor: '#666C38', paddingVertical: 10, paddingHorizontal: 12, gap: 9 },
  noticeText: { color: '#F5E9BA', flex: 1, fontSize: 12, lineHeight: 18 },
  noticeDismiss: { color: '#F5E9BA', fontWeight: '800', padding: 8, fontSize: 12 },
  readerFrame: { flex: 1 },
  hiddenFrame: { display: 'none' },
  webview: { flex: 1, backgroundColor: '#07090E' },
  loading: { ...StyleSheet.absoluteFillObject, backgroundColor: '#07090E', alignItems: 'center', justifyContent: 'center', gap: 16 },
  loadingLabel: { color: '#B4C5D3', fontSize: 14 },
  loadError: { ...StyleSheet.absoluteFillObject, backgroundColor: '#07090E', alignItems: 'center', justifyContent: 'center', padding: 25, gap: 16 },
  errorHeading: { color: '#FFFFFF', fontSize: 23, fontWeight: '800', textAlign: 'center', marginBottom: 8 },
  bodyText: { color: '#A9B4C8', fontSize: 13, lineHeight: 20, marginTop: 9 },
  primaryButton: { minHeight: 48, backgroundColor: '#12B6C8', borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 22, marginTop: 10 },
  primaryButtonText: { color: '#021017', fontWeight: '900', fontSize: 15 },
  page: { flex: 1 },
  pageContent: { padding: 20, paddingBottom: 45 },
  pageHeading: { color: '#F2F6FF', fontSize: 23, fontWeight: '800', marginBottom: 8 },
  pageDescription: { color: '#9AACC2', fontSize: 13, lineHeight: 21, marginBottom: 22 },
  emptyCard: { backgroundColor: '#111D2A', borderColor: '#2A3A4E', borderWidth: 1, borderRadius: 18, padding: 19 },
  cardTitle: { color: '#F0F6FF', fontSize: 16, fontWeight: '700', marginBottom: 10 },
  secondaryButton: { alignSelf: 'flex-start', borderRadius: 10, backgroundColor: '#254B58', justifyContent: 'center', minHeight: 44, paddingHorizontal: 16, marginTop: 14 },
  secondaryButtonText: { color: '#C7F5FB', fontSize: 14, fontWeight: '700' },
  savedCard: { backgroundColor: '#111D2A', borderColor: '#2A3A4E', borderWidth: 1, borderRadius: 16, padding: 16, marginBottom: 12 },
  actionRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  smallButton: { borderColor: '#3E6C78', borderWidth: 1, borderRadius: 10, justifyContent: 'center', minHeight: 44, paddingHorizontal: 13 },
  smallButtonText: { color: '#C4EAF2', fontWeight: '700', fontSize: 12 },
  dangerButton: { borderColor: '#703E50', borderWidth: 1, borderRadius: 10, justifyContent: 'center', minHeight: 44, paddingHorizontal: 13 },
  dangerText: { color: '#FFB3C4', fontSize: 12, fontWeight: '700' },
  settingsCard: { backgroundColor: '#111D2A', borderColor: '#2A3A4E', borderWidth: 1, borderRadius: 18, padding: 16, marginBottom: 16 },
  settingLink: { borderTopColor: '#2A3A4E', borderTopWidth: 1, minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  settingLinkText: { color: '#C4F4FC', fontSize: 14, fontWeight: '600' },
  settingArrow: { color: '#91E0E8', fontSize: 23 },
  versionText: { color: '#7192A5', fontSize: 11, marginTop: 12 },
  tabBar: { minHeight: 66, paddingTop: 6, flexDirection: 'row', alignItems: 'stretch', backgroundColor: '#0B1421', borderTopColor: '#273D50', borderTopWidth: 1, paddingHorizontal: 9 },
  navButton: { flex: 1, minHeight: 52, marginHorizontal: 2, justifyContent: 'center', alignItems: 'center', borderRadius: 13 },
  navButtonActive: { backgroundColor: '#174451', borderColor: '#277785', borderWidth: 1 },
  navText: { color: '#A7B4C6', fontWeight: '700', fontSize: 13 },
  navTextActive: { color: '#A9F5FA' },
});
