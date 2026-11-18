package com.edrielton.lucky.ai

import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class NvidiaNimClient(private val store: NvidiaConfigStore) {
    fun complete(prompt: String, system: String = "You are Lucky, a precise personal AI assistant. Respond in Brazilian Portuguese.") : String {
        val config = store.load()
        require(config.apiKey.isNotBlank()) { "Configure a chave NVIDIA NIM na aba API." }
        require(prompt.isNotBlank() && prompt.length <= 50_000) { "Prompt vazio ou acima do limite." }
        val endpoint = config.baseUrl.trimEnd('/') + "/chat/completions"
        val connection = (URL(endpoint).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 20_000
            readTimeout = 90_000
            doOutput = true
            setRequestProperty("Authorization", "Bearer ${config.apiKey}")
            setRequestProperty("Content-Type", "application/json")
            setRequestProperty("Accept", "application/json")
        }
        try {
            val body = JSONObject()
                .put("model", config.model)
                .put("messages", JSONArray()
                    .put(JSONObject().put("role", "system").put("content", system))
                    .put(JSONObject().put("role", "user").put("content", prompt)))
                .put("temperature", 0.2)
                .put("max_tokens", 4096)
            connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val code = connection.responseCode
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            val response = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
            if (code !in 200..299) {
                val message = try { JSONObject(response).optJSONObject("error")?.optString("message") } catch (_: Exception) { null }
                throw IllegalStateException("NVIDIA NIM HTTP $code: ${message ?: response.take(500)}")
            }
            val json = JSONObject(response)
            return json.optJSONArray("choices")?.optJSONObject(0)?.optJSONObject("message")?.optString("content")
                ?.takeIf { it.isNotBlank() } ?: throw IllegalStateException("NVIDIA NIM retornou uma resposta vazia.")
        } finally {
            connection.disconnect()
        }
    }

    fun test(): String = complete("Responda apenas: conexão NVIDIA NIM funcionando.", "Você é um verificador de conexão. Responda de forma curta.")
}
