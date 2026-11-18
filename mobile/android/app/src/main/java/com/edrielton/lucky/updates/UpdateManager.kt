package com.edrielton.lucky.updates

import android.content.Context
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

data class UpdateResult(
    val installedVersion: String,
    val updatedFiles: List<String>,
    val message: String
)

class UpdateManager(context: Context) {
    private val appContext = context.applicationContext
    private val prefs = appContext.getSharedPreferences("lucky_updates_v1", Context.MODE_PRIVATE)
    private val runtimeRoot = File(appContext.filesDir, "lucky-runtime")
    private val feedBase = "https://raw.githubusercontent.com/edrielton/Lucky/feature/lucky-mobile-android/updates/stable"
    private val manifestUrl = "$feedBase/manifest.json"

    fun installedVersion(): String = prefs.getString("installed_version", "0.0.0") ?: "0.0.0"

    fun checkAndApply(): UpdateResult {
        val manifestBytes = download(manifestUrl, 64 * 1024)
        val manifest = JSONObject(manifestBytes.toString(Charsets.UTF_8))
        val version = manifest.getString("version")
        require(version.matches(Regex("\\d+(\\.\\d+){1,3}"))) { "Versão do pacote inválida." }
        val minimumAppCode = manifest.optInt("minAppVersionCode", 1)
        require(minimumAppCode <= 2) { "Esta atualização exige uma versão mais recente do aplicativo." }

        val current = installedVersion()
        if (compareVersions(version, current) <= 0) {
            return UpdateResult(current, emptyList(), "Lucky já está atualizado (pacote $current).")
        }

        val entries = manifest.optJSONArray("files")
            ?: throw IllegalArgumentException("Manifesto sem lista de arquivos.")
        require(entries.length() in 1..20) { "Quantidade de arquivos fora do limite." }

        val staging = File(appContext.filesDir, "lucky-update-staging").apply {
            deleteRecursively()
            mkdirs()
        }
        val backup = File(appContext.filesDir, "lucky-update-backup").apply {
            deleteRecursively()
            mkdirs()
        }
        val validated = mutableListOf<Pair<File, File>>()
        try {
            for (index in 0 until entries.length()) {
                val entry = entries.getJSONObject(index)
                val relativePath = entry.getString("path")
                require(relativePath.startsWith("runtime/") &&
                    relativePath.endsWith(".json") &&
                    !relativePath.contains("..") &&
                    !relativePath.startsWith("/") &&
                    !relativePath.contains("\\")) { "Caminho de pacote não permitido." }

                val url = entry.getString("url")
                require(url.startsWith("$feedBase/")) { "Origem externa não permitida." }
                val expectedSize = entry.getLong("size")
                require(expectedSize in 2..524288) { "Tamanho de pacote fora do limite." }
                val expectedHash = entry.getString("sha256").lowercase()
                require(expectedHash.matches(Regex("[a-f0-9]{64}"))) { "Hash SHA-256 inválido." }

                val bytes = download(url, expectedSize.toInt())
                require(bytes.size.toLong() == expectedSize) { "Tamanho divergente em $relativePath." }
                require(sha256(bytes) == expectedHash) { "Integridade inválida em $relativePath." }
                val json = JSONObject(bytes.toString(Charsets.UTF_8))
                require(json.has("schemaVersion")) { "Pacote JSON sem schemaVersion." }

                val stagedFile = safeFile(staging, relativePath.removePrefix("runtime/"))
                stagedFile.parentFile?.mkdirs()
                stagedFile.writeBytes(bytes)
                val targetFile = safeFile(runtimeRoot, relativePath.removePrefix("runtime/"))
                validated += stagedFile to targetFile
            }

            val replaced = mutableListOf<Pair<File, File?>>()
            try {
                validated.forEachIndexed { index, pair ->
                    val (stagedFile, targetFile) = pair
                    val backupFile = safeFile(backup, index.toString())
                    targetFile.parentFile?.mkdirs()
                    val previous = if (targetFile.exists()) {
                        backupFile.parentFile?.mkdirs()
                        check(targetFile.copyTo(backupFile, overwrite = true).exists())
                        backupFile
                    } else null
                    replaced += targetFile to previous
                    check(stagedFile.copyTo(targetFile, overwrite = true).exists())
                }
                prefs.edit().putString("installed_version", version).apply()
            } catch (error: Exception) {
                replaced.asReversed().forEach { (target, previous) ->
                    if (previous != null && previous.exists()) previous.copyTo(target, overwrite = true)
                    else target.delete()
                }
                throw error
            }

            return UpdateResult(version, validated.map { it.second.relativeTo(runtimeRoot).invariantSeparatorsPath },
                "Pacote $version instalado e validado. Nenhum código executável foi carregado.")
        } finally {
            staging.deleteRecursively()
            backup.deleteRecursively()
        }
    }

    private fun safeFile(root: File, relative: String): File {
        val canonicalRoot = root.canonicalFile
        val candidate = File(root, relative).canonicalFile
        require(candidate.path.startsWith(canonicalRoot.path + File.separator)) { "Caminho fora da área permitida." }
        return candidate
    }

    private fun download(address: String, maxBytes: Int): ByteArray {
        val url = URL(address)
        require(url.protocol == "https" && url.host == "raw.githubusercontent.com") {
            "Atualizações exigem HTTPS e origem GitHub Raw autorizada."
        }
        val connection = (url.openConnection() as HttpURLConnection).apply {
            connectTimeout = 12_000
            readTimeout = 20_000
            requestMethod = "GET"
            setRequestProperty("Accept", "application/json")
            instanceFollowRedirects = false
        }
        try {
            val code = connection.responseCode
            require(code == HttpURLConnection.HTTP_OK) { "Servidor de atualização respondeu HTTP $code." }
            val output = ByteArrayOutputStream()
            connection.inputStream.use { input ->
                val buffer = ByteArray(8192)
                var total = 0
                while (true) {
                    val count = input.read(buffer)
                    if (count < 0) break
                    total += count
                    require(total <= maxBytes) { "Resposta excedeu o limite permitido." }
                    output.write(buffer, 0, count)
                }
            }
            return output.toByteArray()
        } finally {
            connection.disconnect()
        }
    }

    private fun sha256(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

    private fun compareVersions(left: String, right: String): Int {
        val a = left.split(".").map { it.toInt() }
        val b = right.split(".").map { it.toInt() }
        for (index in 0 until maxOf(a.size, b.size)) {
            val difference = (a.getOrNull(index) ?: 0).compareTo(b.getOrNull(index) ?: 0)
            if (difference != 0) return difference
        }
        return 0
    }
}
