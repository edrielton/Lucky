package com.edrielton.lucky.core

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest

data class LuckyRecord(val id: String, val title: String, val body: String, val createdAt: Long)
data class LuckyMission(val id: String, val title: String, val detail: String, val status: String, val createdAt: Long)

class LuckyKernel(context: Context) {
    private val prefs = context.getSharedPreferences("lucky_kernel_v1", Context.MODE_PRIVATE)

    val emergencyStop: Boolean
        get() = prefs.getBoolean("emergency_stop", false)

    fun updateEmergencyStop(enabled: Boolean) {
        prefs.edit().putBoolean("emergency_stop", enabled).apply()
        audit(if (enabled) "EMERGENCY_STOP_ENABLED" else "EMERGENCY_STOP_DISABLED", "Execução de missões bloqueada/reativada pelo usuário")
    }

    fun addMemory(title: String, body: String) {
        val rows = readArray("memory")
        rows.put(JSONObject().put("id", java.util.UUID.randomUUID().toString()).put("title", title.take(160)).put("body", body.take(8000)).put("createdAt", System.currentTimeMillis()))
        prefs.edit().putString("memory", rows.toString()).apply()
        audit("MEMORY_ADDED", title.take(160))
    }

    fun memories(): List<LuckyRecord> = records("memory")

    fun addMission(title: String, detail: String) {
        val rows = readArray("missions")
        rows.put(JSONObject().put("id", java.util.UUID.randomUUID().toString()).put("title", title.take(160)).put("detail", detail.take(4000)).put("status", "PENDENTE").put("createdAt", System.currentTimeMillis()))
        prefs.edit().putString("missions", rows.toString()).apply()
        audit("MISSION_CREATED", title.take(160))
    }

    fun missions(): List<LuckyMission> {
        val rows = readArray("missions")
        return (0 until rows.length()).mapNotNull { i ->
            rows.optJSONObject(i)?.let { LuckyMission(it.optString("id"), it.optString("title"), it.optString("detail"), it.optString("status"), it.optLong("createdAt")) }
        }.reversed()
    }

    fun updateMission(id: String, status: String) {
        require(status in setOf("PENDENTE", "EM_ANDAMENTO", "CONCLUIDA", "BLOQUEADA"))
        val rows = readArray("missions")
        for (i in 0 until rows.length()) {
            val row = rows.optJSONObject(i) ?: continue
            if (row.optString("id") == id) row.put("status", status)
        }
        prefs.edit().putString("missions", rows.toString()).apply()
        audit("MISSION_STATUS", "$id -> $status")
    }

    fun requestApproval(scope: String, payload: String): String {
        val hash = sha256("$scope\n$payload")
        val rows = readArray("pending_approvals")
        rows.put(JSONObject().put("hash", hash).put("scope", scope.take(120)).put("payload", payload.take(12000)).put("createdAt", System.currentTimeMillis()))
        prefs.edit().putString("pending_approvals", rows.toString()).apply()
        audit("APPROVAL_REQUESTED", "$scope [$hash]")
        return hash
    }

    fun pendingApprovals(): List<JSONObject> {
        val rows = readArray("pending_approvals")
        return (0 until rows.length()).mapNotNull { rows.optJSONObject(it) }
    }

    fun consumeApproval(hash: String): Boolean {
        val rows = readArray("pending_approvals")
        var found = false
        val kept = JSONArray()
        for (i in 0 until rows.length()) {
            val row = rows.optJSONObject(i) ?: continue
            if (!found && row.optString("hash") == hash) found = true else kept.put(row)
        }
        if (found) {
            prefs.edit().putString("pending_approvals", kept.toString()).apply()
            audit("APPROVAL_CONSUMED", hash)
        }
        return found
    }

    fun audit(event: String, detail: String) {
        val rows = readArray("audit")
        rows.put(JSONObject().put("event", event.take(100)).put("detail", detail.take(1000)).put("at", System.currentTimeMillis()))
        val bounded = JSONArray()
        val start = (rows.length() - 300).coerceAtLeast(0)
        for (i in start until rows.length()) bounded.put(rows.getJSONObject(i))
        prefs.edit().putString("audit", bounded.toString()).apply()
    }

    fun auditLog(): List<String> {
        val rows = readArray("audit")
        return (0 until rows.length()).mapNotNull { i ->
            rows.optJSONObject(i)?.let { "${it.optString("event")}: ${it.optString("detail")}" }
        }.reversed()
    }

    private fun records(key: String): List<LuckyRecord> {
        val rows = readArray(key)
        return (0 until rows.length()).mapNotNull { i ->
            rows.optJSONObject(i)?.let { LuckyRecord(it.optString("id"), it.optString("title"), it.optString("body"), it.optLong("createdAt")) }
        }.reversed()
    }

    private fun readArray(key: String): JSONArray = try { JSONArray(prefs.getString(key, "[]")) } catch (_: Exception) { JSONArray() }

    private fun sha256(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
}
