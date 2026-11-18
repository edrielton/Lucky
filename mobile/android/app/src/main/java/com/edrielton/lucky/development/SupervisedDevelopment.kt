package com.edrielton.lucky.development

import android.content.Context
import com.edrielton.lucky.core.LuckyKernel
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest

data class StagedCorrection(
    val id: String,
    val summary: String,
    val relativePath: String,
    val content: String,
    val sha256: String,
    val approvalHash: String,
    val status: String
)

/**
 * Android-side proposal staging. It never edits the selected/original project.
 * Android does not execute arbitrary project code here; isolated execution and
 * regression testing remain unavailable until a real sandbox runner is connected.
 */
class SupervisedDevelopment(context: Context, private val kernel: LuckyKernel) {
    private val root = File(context.filesDir, "development/sandbox").apply { mkdirs() }

    fun stage(rawJson: String): StagedCorrection {
        require(!kernel.emergencyStop) { "Botão de emergência ativado: desenvolvimento bloqueado." }
        require(rawJson.length <= 120_000) { "Proposta excede o limite de tamanho." }
        val json = JSONObject(rawJson.trim().removePrefix("```json").removeSuffix("```").trim())
        val summary = json.optString("summary").trim()
        val path = json.optString("path").replace('\\', '/')
        val content = json.optString("content")
        require(summary.isNotBlank() && summary.length <= 1000) { "Resumo inválido." }
        validatePath(path)
        require(content.isNotEmpty() && content.toByteArray().size <= 1_000_000) { "Conteúdo vazio ou acima de 1 MB." }

        val id = java.util.UUID.randomUUID().toString()
        val digest = sha256("$path\n$content")
        val dir = File(root, id).apply { mkdirs() }
        val staged = File(dir, path)
        require(staged.canonicalPath.startsWith(dir.canonicalPath + File.separator)) { "Caminho fora da sandbox." }
        staged.parentFile?.mkdirs()
        staged.writeText(content, Charsets.UTF_8)
        val manifest = JSONObject().put("id", id).put("summary", summary).put("path", path)
            .put("sha256", digest).put("status", "AGUARDANDO_REVISAO")
        File(dir, "proposal.json").writeText(manifest.toString(2), Charsets.UTF_8)
        val approvalHash = kernel.requestApproval("CORRECAO_SUPERVISIONADA:$id", "$summary\n$path\n$digest")
        kernel.audit("CORRECTION_STAGED", "$id $path; aguardando revisão humana; sem execução")
        return StagedCorrection(id, summary, path, content, digest, approvalHash, "AGUARDANDO_REVISAO")
    }

    fun approveForManualReview(proposal: StagedCorrection): Boolean {
        // Consumes a one-time approval, but deliberately does not promote to the original project.
        val consumed = kernel.consumeApproval(proposal.approvalHash)
        if (consumed) kernel.audit("CORRECTION_REVIEW_APPROVED", "${proposal.id}; permanece na sandbox; testes não executados")
        return consumed
    }

    fun sandboxRoot(): String = root.absolutePath

    private fun validatePath(path: String) {
        require(path.isNotBlank() && path.length <= 240 && !path.startsWith("/") && !Regex("^[A-Za-z]:").containsMatchIn(path)) { "Caminho absoluto ou inválido." }
        val parts = path.split('/')
        require(parts.none { it.isBlank() || it == "." || it == ".." }) { "Traversal bloqueado." }
        require(parts.none { it.equals(".git", true) || it.equals("node_modules", true) || it.startsWith(".env", true) }) { "Caminho protegido." }
        val normalized = path.lowercase()
        require(normalized !in setOf("package.json", "package-lock.json", "tsconfig.json") &&
            !normalized.startsWith("test/") && !normalized.startsWith("tests/") &&
            !normalized.startsWith("src/kernel/") && !normalized.startsWith("src/security/") &&
            !normalized.startsWith("src/testing/") && !normalized.startsWith("src/development/")) { "Arquivo protegido: alteração recusada." }
    }

    private fun sha256(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
}
