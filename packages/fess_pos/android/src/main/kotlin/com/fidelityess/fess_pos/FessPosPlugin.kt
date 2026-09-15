package com.fidelityess.fess_pos

import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import io.flutter.embedding.engine.plugins.FlutterPlugin
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel

/**
 * What Android does to hold the module's background work back, and the
 * settings screen where the agent can exempt the app (T5-02, D-95).
 * Asks for no permission: the agent exempts the app themselves.
 */
class FessPosPlugin : FlutterPlugin, MethodChannel.MethodCallHandler {
    private var channel: MethodChannel? = null
    private var context: Context? = null

    override fun onAttachedToEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        context = binding.applicationContext
        channel = MethodChannel(binding.binaryMessenger, "fess_pos/power").also {
            it.setMethodCallHandler(this)
        }
    }

    override fun onDetachedFromEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        channel?.setMethodCallHandler(null)
        channel = null
        context = null
    }

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        val context = context ?: return result.error("UNAVAILABLE", "not attached", null)
        when (call.method) {
            "status" -> result.success(status(context))
            "openSettings" -> result.success(openSettings(context))
            else -> result.notImplemented()
        }
    }

    /** Null where this Android version can't say. */
    private fun status(context: Context): Map<String, Any?> {
        val batteryOptimised = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val power = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
            power?.let { !it.isIgnoringBatteryOptimizations(context.packageName) }
        } else {
            null
        }
        val backgroundRestricted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            val activity = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
            activity?.isBackgroundRestricted
        } else {
            null
        }
        return mapOf(
            "battery_optimised" to batteryOptimised,
            "background_restricted" to backgroundRestricted,
        )
    }

    /** The battery optimisation list, else the app's own settings page. */
    private fun openSettings(context: Context): Boolean {
        val intents = listOf(
            Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS),
            Intent(
                Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.parse("package:${context.packageName}"),
            ),
        )
        for (intent in intents) {
            try {
                context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                return true
            } catch (e: RuntimeException) {
                // Not on this phone, or not allowed: try the next.
            }
        }
        return false
    }
}
