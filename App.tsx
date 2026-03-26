import React, { useState, useEffect } from 'react';
import { NativeModules } from 'react-native';
import {
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Linking,
} from 'react-native';
import nodejs from 'nodejs-mobile-react-native';

const { ProxyServiceModule } = NativeModules;

const App = () => {
  const [isRunning, setIsRunning] = useState(false);
  const [stats, setStats] = useState({ activeConnections: 0, totalBytesTransferred: 0 });
  const [proxyHost, setProxyHost] = useState('127.0.0.1');
  const [proxyPort, setProxyPort] = useState('1080');

  useEffect(() => {
    // Слушаем сообщения от фонового Node.js процесса
    const listener = (msg: string) => {
      try {
        const data = JSON.parse(msg);
        if (data.type === 'status') {
          setIsRunning(data.isRunning);
          if (data.host) setProxyHost(data.host);
          if (data.port) setProxyPort(data.port.toString());
        } else if (data.type === 'stats') {
          // Обновляем статистику из Node.js
          setStats({
            activeConnections: data.stats.connectionsTotal,
            totalBytesTransferred: data.stats.bytesUp + data.stats.bytesDown,
          });
        }
      } catch (e) {
        console.error('Error parsing message from nodejs:', e);
      }
    };

    nodejs.channel.addListener('message', listener);
    
    // Запускаем Node.js движок при старте приложения
    nodejs.start('main.js');

    // Каждую секунду запрашиваем свежую статистику у сервера
    const statsInterval = setInterval(() => {
      nodejs.channel.send(JSON.stringify({ type: 'get_stats' }));
    }, 1000);

    return () => {
      nodejs.channel.removeListener('message', listener);
      clearInterval(statsInterval);
    };
  }, []);

  const toggleProxy = () => {
    if (isRunning) {
      // 1. Останавливаем Node.js
      nodejs.channel.send(JSON.stringify({ type: 'stop' }));
      
      // 2. ВЫРУБАЕМ УВЕДОМЛЕНИЕ (убираем бессмертие)
      if (ProxyServiceModule) {
        ProxyServiceModule.stopService();
      }
    } else {
      // 1. Запускаем Node.js
      nodejs.channel.send(JSON.stringify({ 
        type: 'start', 
        port: parseInt(proxyPort, 10),
        host: proxyHost
      }));
      
      // 2. ВРУБАЕМ УВЕДОМЛЕНИЕ (включаем бессмертие)
      if (ProxyServiceModule) {
        ProxyServiceModule.startService();
      }
    }
  };

  const openTelegram = () => {
    const url = `tg://socks?server=${proxyHost}&port=${proxyPort}`;
    Linking.openURL(url).catch(err => console.error('An error occurred', err));
  };

  const formatBytes = (bytes: number) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#F3F4F6" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>TG Proxy</Text>
          <Text style={styles.subtitle}>SOCKS5 сервер для обхода блокировок</Text>
        </View>

        {/* Main Control Card */}
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

        {/* Telegram Connection Info */}
        {isRunning && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Как подключить Telegram</Text>
            <Text style={styles.cardText}>Нажмите на кнопку ниже. Telegram откроется и предложит применить настройки прокси:</Text>
            
            <TouchableOpacity style={styles.tgButton} onPress={openTelegram}>
              <Text style={styles.tgButtonText}>Открыть Telegram и подключить</Text>
            </TouchableOpacity>

            <View style={styles.manualInfo}>
              <Text style={styles.manualTitle}>Вручную:</Text>
              <Text style={styles.manualCode}>SOCKS5 {proxyHost} : {proxyPort}</Text>
            </View>
          </View>
        )}

        {/* Stats Card */}
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
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F3F4F6' },
  scrollContent: { padding: 20 },
  header: { marginBottom: 24, alignItems: 'center' },
  title: { fontSize: 32, fontWeight: 'bold', color: '#111827' },
  subtitle: { fontSize: 16, color: '#6B7280', marginTop: 4 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 20, marginBottom: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 2 },
  statusRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 20, justifyContent: 'center' },
  statusDot: { width: 12, height: 12, borderRadius: 6, marginRight: 8 },
  statusText: { fontSize: 16, fontWeight: '500', color: '#374151' },
  mainButton: { paddingVertical: 16, borderRadius: 12, alignItems: 'center' },
  mainButtonText: { color: '#FFFFFF', fontSize: 18, fontWeight: 'bold' },
  cardTitle: { fontSize: 18, fontWeight: '600', color: '#111827', marginBottom: 12 },
  cardText: { fontSize: 14, color: '#4B5563', marginBottom: 16, lineHeight: 20 },
  tgButton: { backgroundColor: '#EFF6FF', paddingVertical: 14, borderRadius: 12, alignItems: 'center', marginBottom: 16 },
  tgButtonText: { color: '#1D4ED8', fontSize: 16, fontWeight: '600' },
  manualInfo: { borderTopWidth: 1, borderTopColor: '#F3F4F6', paddingTop: 16 },
  manualTitle: { fontSize: 14, fontWeight: '500', color: '#374151', marginBottom: 8 },
  manualCode: { backgroundColor: '#F9FAFB', padding: 12, borderRadius: 8, fontFamily: 'monospace', color: '#4B5563', textAlign: 'center' },
  statsGrid: { flexDirection: 'row', justifyContent: 'space-between' },
  statBox: { flex: 1, backgroundColor: '#F9FAFB', padding: 16, borderRadius: 12, alignItems: 'center', marginHorizontal: 4 },
  statValue: { fontSize: 24, fontWeight: 'bold', color: '#111827', marginBottom: 4 },
  statLabel: { fontSize: 12, color: '#6B7280', textAlign: 'center' },
});

export default App;