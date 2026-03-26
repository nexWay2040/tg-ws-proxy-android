package com.tgproxyapp

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

class ProxyService : Service() {

    companion object {
        private const val CHANNEL_ID = "ProxyChannel"
    }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // 1. Интент для открытия приложения по клику на уведомление
        val notificationIntent = Intent(this, MainActivity::class.java)
        val pendingIntent = PendingIntent.getActivity(
            this, 0, notificationIntent, PendingIntent.FLAG_IMMUTABLE
        )

        // 2. Создаем уведомление
        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("TG Proxy работает")
            .setContentText("Трафик Телеграма защищен 🚀")
            .setSmallIcon(applicationInfo.icon) // Берем иконку приложения
            .setContentIntent(pendingIntent)
            .setOngoing(true) // Несмахиваемое
            .build()

        // 3. Запускаем бессмертный режим
        startForeground(1, notification)

        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? {
        return null
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val serviceChannel = NotificationChannel(
                CHANNEL_ID,
                "TG Proxy Фоновая работа",
                NotificationManager.IMPORTANCE_LOW
            )
            val manager = getSystemService(NotificationManager::class.java)
            manager?.createNotificationChannel(serviceChannel)
        }
    }
}