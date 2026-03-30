import React, { useState, useEffect, useRef, useMemo } from 'react';
import { NativeModules, PermissionsAndroid, Platform, useColorScheme } from 'react-native';
import {
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Linking,
  TextInput,
  Switch,
  Alert,
  Image,
} from 'react-native';
import nodejs from 'nodejs-mobile-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const { ProxyServiceModule } = NativeModules;

// --- НАСТРОЙКИ ПО УМОЛЧАНИЮ ---
const DEFAULT_SETTINGS = {
  ip: '127.0.0.1',
  port: '1080',
  dcList: '2:149.154.167.220\n4:149.154.167.220',
  verbose: false,
  bufferKb: '256',
  poolSize: '4',
};

// --- ФУНКЦИЯ ЗАПРОСА УВЕДОМЛЕНИЙ ---
async function requestNotificationPermission() {
  if (Platform.OS === 'android' && Platform.Version >= 33) {
    try {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
        {
          title: 'Разрешение на уведомления',
          message: 'Нам нужно показывать уведомление, чтобы система не убивала прокси в фоновом режиме.',
          buttonNeutral: 'Позже',
          buttonNegative: 'Отмена',
          buttonPositive: 'ОК',
        },
      );
      return granted === PermissionsAndroid.RESULTS.GRANTED;
    } catch (err) {
      console.warn(err);
      return false;
    }
  }
  return true; 
}

const App = () => {
  // --- ОПРЕДЕЛЕНИЕ ТЕМЫ ТЕЛЕФОНА ---
  const isDarkMode = useColorScheme() === 'dark';

  // Цветовые палитры для светлой и темной темы
  const theme = useMemo(() => ({
    bg: isDarkMode ? '#121212' : '#F3F4F6',
    card: isDarkMode ? '#1E1E1E' : '#FFFFFF',
    text: isDarkMode ? '#F9FAFB' : '#111827',
    textMuted: isDarkMode ? '#9CA3AF' : '#6B7280',
    border: isDarkMode ? '#374151' : '#E5E7EB',
    inputBg: isDarkMode ? '#2A2A2A' : '#F9FAFB',
    navBg: isDarkMode ? '#1E1E1E' : '#FFFFFF',
    iconHex: isDarkMode ? 'D1D5DB' : '374151',
    tgBtnBg: isDarkMode ? '#1E3A8A' : '#EFF6FF',
    tgBtnText: isDarkMode ? '#BFDBFE' : '#1D4ED8',
  }), [isDarkMode]);

  // Генерируем стили на основе текущей темы
  const styles = useMemo(() => createStyles(theme), [theme]);

  // Состояния вкладок и прокси
  const [activeTab, setActiveTab] = useState('main'); 
  const [isRunning, setIsRunning] = useState(false);
  const [stats, setStats] = useState({ activeConnections: 0, totalBytesTransferred: 0 });
  
  // Логи
  const [logs, setLogs] = useState([]);
  const scrollViewRef = useRef();

  // Активные хост и порт
  const [activeHost, setActiveHost] = useState('127.0.0.1');
  const [activePort, setActivePort] = useState('1080');
  
  // Настройки
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const saved = await AsyncStorage.getItem('proxySettings');
        if (saved) setSettings(JSON.parse(saved));
      } catch (e) {
        console.log('Ошибка загрузки настроек', e);
      }
    };
    loadSettings();

    const listener = (msg) => {
      try {
        const data = JSON.parse(msg);
        if (data.type === 'status') {
          setIsRunning(data.isRunning);
          if (data.host) setActiveHost(data.host);
          if (data.port) setActivePort(data.port.toString());
        } else if (data.type === 'stats') {
          setStats({
            activeConnections: data.stats.connectionsTotal,
            totalBytesTransferred: data.stats.bytesUp + data.stats.bytesDown,
          });
        } else if (data.type === 'log') {
          setLogs(prevLogs => {
            const newLogs = [...prevLogs, data.message];
            if (newLogs.length > 100) newLogs.shift(); 
            return newLogs;
          });
        }
      } catch (e) {
        console.error('Error parsing message from nodejs:', e);
      }
    };

    nodejs.channel.addListener('message', listener);
    nodejs.start('main.js');

    const statsInterval = setInterval(() => {
      nodejs.channel.send(JSON.stringify({ type: 'get_stats' }));
    }, 1000);

    return () => {
      nodejs.channel.removeListener('message', listener);
      clearInterval(statsInterval);
    };
  }, []);

  const toggleProxy = async () => {
    if (isRunning) {
      nodejs.channel.send(JSON.stringify({ type: 'stop' }));
      if (ProxyServiceModule) ProxyServiceModule.stopService();
    } else {
      const hasPermission = await requestNotificationPermission();
      if (!hasPermission) {
        Alert.alert("Внимание", "Без разрешения на уведомления прокси может вылетать в фоне!");
      }

      nodejs.channel.send(JSON.stringify({ 
        type: 'start', 
        host: settings.ip,
        port: parseInt(settings.port, 10),
        config: settings 
      }));
      
      if (ProxyServiceModule) ProxyServiceModule.startService();
    }
  };

  const saveSettings = async () => {
    try {
      await AsyncStorage.setItem('proxySettings', JSON.stringify(settings));
      Alert.alert('Успешно', 'Настройки сохранены! Перезапустите прокси, чтобы они применились.');
    } catch (e) {
      Alert.alert('Ошибка', 'Не удалось сохранить настройки');
    }
  };

  const resetSettings = () => {
    setSettings(DEFAULT_SETTINGS);
    AsyncStorage.removeItem('proxySettings');
    Alert.alert('Сброшено', 'Настройки возвращены к заводским.');
  };

  const handleChange = (key, value) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const openTelegram = () => {
    const url = `tg://socks?server=${activeHost}&port=${activePort}`;
    Linking.openURL(url).catch(err => console.error('An error occurred', err));
  };

  const openGitHub = () => {
    const url = 'https://github.com/nexWay2040/tg-ws-proxy-android';
    Linking.openURL(url).catch(err => console.error('An error occurred', err));
  };

  const formatBytes = (bytes) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // ==========================================
  // ЭКРАН 1: ГЛАВНАЯ
  // ==========================================
  const renderMain = () => (
    <ScrollView contentContainerStyle={styles.scrollContent}>
      <View style={styles.header}>
        <Text style={styles.title}>TG Proxy</Text>
        <Text style={styles.subtitle}>SOCKS5 сервер для обхода блокировок</Text>
      </View>

      <View style={styles.card}>
        <View style={styles.statusRow}>
          <View style={[styles.statusDot, { backgroundColor: isRunning ? '#10B981' : '#EF4444' }]} />
          <Text style={styles.statusText}>{isRunning ? 'Прокси работает' : 'Прокси остановлен'}</Text>
        </View>
        
        <TouchableOpacity 
          style={[styles.mainButton, { backgroundColor: isRunning ? '#EF4444' : '#10B981' }]} 
          onPress={toggleProxy}
        >
          <Text style={styles.mainButtonText}>{isRunning ? 'Остановить' : 'Запустить'}</Text>
        </TouchableOpacity>
      </View>

      {isRunning && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Как подключить Telegram</Text>
          <Text style={styles.cardText}>Нажмите на кнопку ниже. Telegram откроется и предложит применить настройки прокси:</Text>
          
          <TouchableOpacity style={styles.tgButton} onPress={openTelegram}>
            <Text style={styles.tgButtonText}>Открыть Telegram и подключить</Text>
          </TouchableOpacity>

          <View style={styles.manualInfo}>
            <Text style={styles.manualTitle}>Вручную:</Text>
            <Text style={styles.manualCode}>SOCKS5 {activeHost} : {activePort}</Text>
          </View>
        </View>
      )}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Статистика</Text>
        <View style={styles.statsGrid}>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{stats.activeConnections}</Text>
            <Text style={styles.statLabel}>Активных соединений</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{formatBytes(stats.totalBytesTransferred)}</Text>
            <Text style={styles.statLabel}>Трафик</Text>
          </View>
        </View>
      </View>
    </ScrollView>
  );

  // ==========================================
  // ЭКРАН 2: НАСТРОЙКИ
  // ==========================================
  const renderSettings = () => (
    <ScrollView style={styles.settingsContainer} contentContainerStyle={{paddingBottom: 40}}>
      <Text style={styles.settingsHeaderTitle}>Настройки прокси</Text>

      <View style={styles.settingsRow}>
        <View style={styles.halfInput}>
          <Text style={styles.settingsLabel}>IP-адрес</Text>
          <TextInput style={styles.settingsInput} value={settings.ip} onChangeText={(t) => handleChange('ip', t)} />
        </View>
        <View style={styles.halfInput}>
          <Text style={styles.settingsLabel}>Порт</Text>
          <TextInput style={styles.settingsInput} value={settings.port} keyboardType="numeric" onChangeText={(t) => handleChange('port', t)} />
        </View>
      </View>

      <Text style={styles.settingsLabel}>Датацентры Telegram (DC → IP)</Text>
      <TextInput 
        style={[styles.settingsInput, styles.textArea]} 
        value={settings.dcList} 
        multiline 
        onChangeText={(t) => handleChange('dcList', t)} 
      />

      <View style={styles.settingsCard}>
        <Text style={styles.settingsCardTitle}>Логи и производительность</Text>
        
        <View style={styles.switchRow}>
          <Text style={styles.settingsLabelSwitch}>Подробное логирование (verbose)</Text>
          <Switch 
            value={settings.verbose} 
            onValueChange={(v) => handleChange('verbose', v)} 
            trackColor={{ false: theme.border, true: "#10B981" }}
            thumbColor={"#ffffff"}
          />
        </View>

        <Text style={styles.settingsLabel}>Буфер, КБ (по умолчанию 256)</Text>
        <TextInput style={styles.settingsInput} value={settings.bufferKb} keyboardType="numeric" onChangeText={(t) => handleChange('bufferKb', t)} />

        <Text style={styles.settingsLabel}>Пул WebSocket-сессий (по умолчанию 4)</Text>
        <TextInput style={styles.settingsInput} value={settings.poolSize} keyboardType="numeric" onChangeText={(t) => handleChange('poolSize', t)} />
      </View>

      <View style={styles.buttonRow}>
        <TouchableOpacity style={styles.saveBtn} onPress={saveSettings}>
          <Text style={styles.btnTextWhite}>Сохранить</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.resetBtn} onPress={resetSettings}>
          <Text style={styles.btnText}>Сброс</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );

  // ==========================================
  // ЭКРАН 3: ЛОГИ
  // ==========================================
  const renderLogs = () => (
    <View style={styles.logsContainer}>
      <View style={styles.logsHeaderRow}>
        <Text style={styles.settingsHeaderTitle}>Терминал (Логи)</Text>
        <TouchableOpacity onPress={() => setLogs([])} style={styles.clearBtn}>
          <Text style={styles.clearBtnText}>Очистить</Text>
        </TouchableOpacity>
      </View>
      
      <ScrollView 
        style={styles.logsScroll}
        ref={scrollViewRef}
        onContentSizeChange={() => scrollViewRef.current.scrollToEnd({ animated: true })}
      >
        {logs.length === 0 ? (
          <Text style={styles.logTextEmpty}>Логов пока нет. Запустите прокси...</Text>
        ) : (
          logs.map((logMsg, index) => (
            <Text key={index} style={styles.logText}>
              <Text style={styles.logPrefix}>></Text> {logMsg}
            </Text>
          ))
        )}
      </ScrollView>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar 
        barStyle={isDarkMode ? "light-content" : "dark-content"} 
        backgroundColor={theme.bg} 
      />
      
      {/* ВЕРХНЯЯ ПАНЕЛЬ С ЛОГОТИПОМ GITHUB */}
      <View style={styles.topBar}>
        <View style={{flex: 1}} />
        <TouchableOpacity onPress={openGitHub} style={styles.githubBtn}>
          <Image 
            source={{ uri: `https://api.iconify.design/mdi:github.png?color=%23${theme.iconHex}` }} 
            style={styles.githubIcon} 
          />
          <Text style={styles.githubBtnText}>GitHub</Text>
        </TouchableOpacity>
      </View>

      {/* КОНТЕНТ */}
      <View style={styles.content}>
        {activeTab === 'main' && renderMain()}
        {activeTab === 'settings' && renderSettings()}
        {activeTab === 'logs' && renderLogs()}
      </View>

      {/* НИЖНЕЕ МЕНЮ (НАВИГАЦИЯ) */}
      <View style={styles.bottomNav}>
        <TouchableOpacity style={styles.navItem} onPress={() => setActiveTab('main')}>
          <Text style={[styles.navIcon, activeTab === 'main' && styles.navActive]}>🏠</Text>
          <Text style={[styles.navText, activeTab === 'main' && styles.navActive]}>Главная</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.navItem} onPress={() => setActiveTab('logs')}>
          <Text style={[styles.navIcon, activeTab === 'logs' && styles.navActive]}>📝</Text>
          <Text style={[styles.navText, activeTab === 'logs' && styles.navActive]}>Логи</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.navItem} onPress={() => setActiveTab('settings')}>
          <Text style={[styles.navIcon, activeTab === 'settings' && styles.navActive]}>⚙️</Text>
          <Text style={[styles.navText, activeTab === 'settings' && styles.navActive]}>Настройки</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

// --- ДИНАМИЧЕСКИЕ СТИЛИ (ЗАВИСЯТ ОТ ТЕМЫ) ---
const createStyles = (theme) => StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  content: { flex: 1, backgroundColor: theme.bg },
  
  // Верхняя панель
  topBar: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 20, paddingTop: 10, paddingBottom: 5, backgroundColor: theme.bg },
  githubBtn: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 12, backgroundColor: theme.inputBg, borderRadius: 8, borderWidth: 1, borderColor: theme.border },
  githubIcon: { width: 20, height: 20, marginRight: 6, resizeMode: 'contain' },
  githubBtnText: { fontSize: 14, fontWeight: '600', color: theme.text },

  // Главный экран
  scrollContent: { padding: 20, paddingTop: 0 },
  header: { marginBottom: 24, alignItems: 'center' },
  title: { fontSize: 32, fontWeight: 'bold', color: theme.text },
  subtitle: { fontSize: 16, color: theme.textMuted, marginTop: 4 },
  card: { backgroundColor: theme.card, borderRadius: 16, padding: 20, marginBottom: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 2, borderWidth: 1, borderColor: theme.border },
  statusRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 20, justifyContent: 'center' },
  statusDot: { width: 12, height: 12, borderRadius: 6, marginRight: 8 },
  statusText: { fontSize: 16, fontWeight: '500', color: theme.text },
  mainButton: { paddingVertical: 16, borderRadius: 12, alignItems: 'center' },
  mainButtonText: { color: '#FFFFFF', fontSize: 18, fontWeight: 'bold' },
  cardTitle: { fontSize: 18, fontWeight: '600', color: theme.text, marginBottom: 12 },
  cardText: { fontSize: 14, color: theme.textMuted, marginBottom: 16, lineHeight: 20 },
  tgButton: { backgroundColor: theme.tgBtnBg, paddingVertical: 14, borderRadius: 12, alignItems: 'center', marginBottom: 16 },
  tgButtonText: { color: theme.tgBtnText, fontSize: 16, fontWeight: '600' },
  manualInfo: { borderTopWidth: 1, borderTopColor: theme.border, paddingTop: 16 },
  manualTitle: { fontSize: 14, fontWeight: '500', color: theme.text, marginBottom: 8 },
  manualCode: { backgroundColor: theme.inputBg, padding: 12, borderRadius: 8, fontFamily: 'monospace', color: theme.textMuted, textAlign: 'center', borderWidth: 1, borderColor: theme.border },
  statsGrid: { flexDirection: 'row', justifyContent: 'space-between' },
  statBox: { flex: 1, backgroundColor: theme.inputBg, padding: 16, borderRadius: 12, alignItems: 'center', marginHorizontal: 4, borderWidth: 1, borderColor: theme.border },
  statValue: { fontSize: 24, fontWeight: 'bold', color: theme.text, marginBottom: 4 },
  statLabel: { fontSize: 12, color: theme.textMuted, textAlign: 'center' },

  // Настройки
  settingsContainer: { flex: 1, padding: 20, paddingTop: 0, backgroundColor: theme.bg },
  settingsHeaderTitle: { fontSize: 24, fontWeight: 'bold', color: theme.text, marginBottom: 20 },
  settingsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  halfInput: { width: '48%' },
  settingsLabel: { color: theme.textMuted, fontSize: 12, marginBottom: 5, marginTop: 10 },
  settingsLabelSwitch: { color: theme.text, fontSize: 14 },
  settingsInput: { backgroundColor: theme.inputBg, color: theme.text, borderRadius: 8, paddingHorizontal: 15, paddingVertical: 10, borderWidth: 1, borderColor: theme.border, fontSize: 14 },
  textArea: { height: 100, textAlignVertical: 'top' },
  settingsCard: { backgroundColor: theme.card, borderRadius: 10, padding: 15, marginTop: 20, borderWidth: 1, borderColor: theme.border },
  settingsCardTitle: { color: theme.text, fontSize: 16, fontWeight: 'bold', marginBottom: 15 },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  buttonRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 25 },
  saveBtn: { backgroundColor: '#10B981', padding: 15, borderRadius: 8, width: '48%', alignItems: 'center' },
  resetBtn: { backgroundColor: theme.inputBg, padding: 15, borderRadius: 8, width: '48%', alignItems: 'center', borderWidth: 1, borderColor: theme.border },
  btnTextWhite: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  btnText: { color: theme.text, fontWeight: 'bold', fontSize: 16 },

  // Логи
  logsContainer: { flex: 1, padding: 20, paddingTop: 0, backgroundColor: theme.bg },
  logsHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  clearBtn: { backgroundColor: theme.inputBg, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: theme.border },
  clearBtnText: { color: theme.text, fontSize: 12 },
  logsScroll: { flex: 1, backgroundColor: '#000000', borderRadius: 8, padding: 10, borderWidth: 1, borderColor: theme.border },
  logText: { color: '#00ff00', fontFamily: 'monospace', fontSize: 11, marginBottom: 4 },
  logPrefix: { color: '#888' },
  logTextEmpty: { color: '#666', fontFamily: 'monospace', fontSize: 12, textAlign: 'center', marginTop: 20 },

  // Нижнее меню
  bottomNav: { flexDirection: 'row', backgroundColor: theme.navBg, paddingVertical: 10, borderTopWidth: 1, borderTopColor: theme.border, elevation: 10, shadowColor: '#000', shadowOffset: { width: 0, height: -2 }, shadowOpacity: 0.1, shadowRadius: 4 },
  navItem: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  navIcon: { fontSize: 22, opacity: 0.4 },
  navText: { color: theme.textMuted, fontSize: 12, marginTop: 4, fontWeight: '500' },
  navActive: { color: '#10B981', opacity: 1 },
});

export default App;