package com.edrielton.lucky.ai

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

data class NvidiaConfig(val apiKey: String, val baseUrl: String, val model: String)

class NvidiaConfigStore(context: Context) {
    private val prefs = context.getSharedPreferences("lucky_nvidia_secure", Context.MODE_PRIVATE)
    private val alias = "lucky_nvidia_api_aes_gcm"

    fun load(): NvidiaConfig {
        val encrypted = prefs.getString("api_key", null)
        val key = encrypted?.let { decrypt(it) }.orEmpty()
        return NvidiaConfig(
            apiKey = key,
            baseUrl = prefs.getString("base_url", "https://integrate.api.nvidia.com/v1") ?: "https://integrate.api.nvidia.com/v1",
            model = prefs.getString("model", "meta/llama-3.1-8b-instruct") ?: "meta/llama-3.1-8b-instruct"
        )
    }

    fun save(apiKey: String, baseUrl: String, model: String) {
        require(baseUrl.startsWith("https://")) { "O endereço da API precisa usar HTTPS." }
        require(baseUrl.length <= 300 && model.isNotBlank() && model.length <= 180) { "Configuração inválida." }
        val normalized = baseUrl.trim().trimEnd('/')
        val encrypted = if (apiKey.isBlank()) "" else encrypt(apiKey.trim())
        prefs.edit()
            .putString("api_key", encrypted)
            .putString("base_url", normalized)
            .putString("model", model.trim())
            .apply()
    }

    fun hasKey(): Boolean = load().apiKey.isNotBlank()

    private fun secretKey(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(alias, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true)
            .build())
        return generator.generateKey()
    }

    private fun encrypt(value: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        val combined = cipher.iv + cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        return Base64.encodeToString(combined, Base64.NO_WRAP)
    }

    private fun decrypt(value: String): String {
        val combined = Base64.decode(value, Base64.NO_WRAP)
        require(combined.size > 12) { "Chave armazenada inválida." }
        val iv = combined.copyOfRange(0, 12)
        val payload = combined.copyOfRange(12, combined.size)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(128, iv))
        return String(cipher.doFinal(payload), Charsets.UTF_8)
    }
}
