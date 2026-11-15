const rules = [
  { id: 'tls-verification', match: /\brejectUnauthorized\s*:\s*false\b|\bNODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0\b/, title: 'Отключена проверка сертификата TLS', fix: 'Включите проверку сертификата. Для частного центра сертификации настройте доверенный CA.' },
  { id: 'insecure-cookie', match: /\bhttpOnly\s*:\s*false\b/, title: 'Возможен доступ JavaScript к cookie сессии', fix: 'Установите HttpOnly для cookie аутентификации.' },
  { id: 'cookie-transport', match: /\bsecure\s*:\s*false\b/, title: 'Возможна передача cookie по HTTP', fix: 'Для cookie сессии установите Secure и используйте HTTPS.' },
  { id: 'token-randomness', match: /\b(?:token|sessionToken|resetToken|csrfToken|apiKey)\s*[:=][^;]{0,150}\bMath\.random\s*\(/i, title: 'Возможный токен на основе Math.random', fix: 'Создавайте токены через node:crypto или Web Crypto.' },
  { id: 'hardcoded-credential', match: /\b(?:api[_-]?key|secret[_-]?key|access[_-]?token|password)\s*[:=]\s*['"][^'"\s]{12,}['"]/i, title: 'Возможный ключ или пароль в коде', fix: 'Перенесите значение в конфигурацию секретов. Если значение настоящее и было опубликовано, замените его.' }
];
export function reviewSource(source) {
  const findings = [];
  for (const [index, line] of source.split(/\r?\n/).entries()) {
    for (const rule of rules) {
      if (rule.match.test(line)) findings.push({ id: rule.id, line: index + 1, title: rule.title, fix: rule.fix });
      if (findings.length === 50) return findings;
    }
  }
  return findings;
}
