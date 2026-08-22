"""Translated copy for the two user-facing transactional emails.

Only the *sentences* live here. The HTML skeleton (the dark header bar, the
button, the card) stays in `email_service.py` so markup is written once and a
translator never has to touch a style attribute.

Rules this module enforces:
  • Fallback is key-by-key, not file-by-file. A locale that is missing one
    sentence renders that one sentence in English instead of a blank — the same
    behaviour i18next gives the app with `fallbackLng`.
  • Placeholders (`{username}`, `{app}`, `{url}`) must survive translation.
    `tests/test_email_i18n.py` fails if a locale drops or invents one, because
    a stray `{` reaches the user as a `KeyError` inside a BackgroundTask — i.e.
    a silently unsent email.

Admin/ops mail (`build_worker_alert_email`) is deliberately English-only.

No RTL locale is listed yet: Arabic is `preview: true` in the app (#104), so
nobody can be in it. Adding one means the layout needs `dir="rtl"` as well as
a copy block — see `utils/ui_languages.py`.
"""
from __future__ import annotations

from ..utils.ui_languages import FALLBACK_UI_LANGUAGE, normalize_ui_language

# `{app}` is the product name as *markup* — the HTML build passes
# "<strong>WordWise</strong>", the plain-text build passes "WordWise" — so the
# same sentence serves both bodies and no locale has to repeat the tag.
_EN: dict[str, str] = {
    "welcome.subject": "Welcome to WordWise 🎬",
    "welcome.greeting": "Hi {username},",
    "welcome.intro": (
        "Welcome to {app} — you now learn English from the movies you actually "
        "want to watch."
    ),
    "welcome.ways_intro": "Three ways to get going:",
    "welcome.way_add": "Add a film you love and explore its vocabulary",
    "welcome.way_save": "Save words as you read — they go straight to your review deck",
    "welcome.way_review": "Do one short review a day to build your streak",
    "welcome.signoff": "See you in the app,",
    "welcome.team": "The WordWise team",
    "reset.subject": "Reset your WordWise password",
    "reset.greeting": "Hi {username},",
    "reset.intro": (
        "Tap the button below to choose a new password. The link is valid for "
        "30 minutes and can be used once."
    ),
    "reset.intro_text": (
        "Choose a new WordWise password by opening the link below "
        "(valid for 30 minutes, single use):"
    ),
    "reset.button": "Reset password",
    "reset.paste_intro": "Or paste this link into your browser:",
    "reset.ignore": (
        "Didn't request this? You can safely ignore this email — your password "
        "stays unchanged."
    ),
    "layout.footer": (
        "You're receiving this because an account was created on WordWise with "
        "this address."
    ),
}

_ES: dict[str, str] = {
    "welcome.subject": "Te damos la bienvenida a WordWise 🎬",
    "welcome.greeting": "Hola {username},",
    "welcome.intro": (
        "Te damos la bienvenida a {app}: ahora aprendes inglés con las "
        "películas que de verdad quieres ver."
    ),
    "welcome.ways_intro": "Tres formas de empezar:",
    "welcome.way_add": "Añade una película que te encante y explora su vocabulario",
    "welcome.way_save": "Guarda palabras mientras lees: van directas a tu mazo de repaso",
    "welcome.way_review": "Haz un repaso corto al día para mantener tu racha",
    "welcome.signoff": "Nos vemos en la app,",
    "welcome.team": "El equipo de WordWise",
    "reset.subject": "Restablece tu contraseña de WordWise",
    "reset.greeting": "Hola {username},",
    "reset.intro": (
        "Pulsa el botón de abajo para elegir una contraseña nueva. El enlace es "
        "válido durante 30 minutos y solo se puede usar una vez."
    ),
    "reset.intro_text": (
        "Elige una contraseña nueva de WordWise abriendo el enlace de abajo "
        "(válido durante 30 minutos, un solo uso):"
    ),
    "reset.button": "Restablecer contraseña",
    "reset.paste_intro": "O pega este enlace en tu navegador:",
    "reset.ignore": (
        "¿No lo has solicitado? Puedes ignorar este correo sin problema: tu "
        "contraseña no cambiará."
    ),
    "layout.footer": (
        "Recibes este correo porque se creó una cuenta de WordWise con esta "
        "dirección."
    ),
}

_PT: dict[str, str] = {
    "welcome.subject": "Boas-vindas ao WordWise 🎬",
    "welcome.greeting": "Olá, {username},",
    "welcome.intro": (
        "Boas-vindas ao {app}: agora você aprende inglês com os filmes que "
        "realmente quer assistir."
    ),
    "welcome.ways_intro": "Três formas de começar:",
    "welcome.way_add": "Adicione um filme que você ama e explore o vocabulário dele",
    "welcome.way_save": (
        "Salve palavras enquanto lê — elas vão direto para o seu baralho de revisão"
    ),
    "welcome.way_review": "Faça uma revisão curta por dia para manter sua sequência",
    "welcome.signoff": "Até logo no app,",
    "welcome.team": "A equipe do WordWise",
    "reset.subject": "Redefina sua senha do WordWise",
    "reset.greeting": "Olá, {username},",
    "reset.intro": (
        "Toque no botão abaixo para escolher uma nova senha. O link vale por 30 "
        "minutos e pode ser usado uma única vez."
    ),
    "reset.intro_text": (
        "Escolha uma nova senha do WordWise abrindo o link abaixo "
        "(válido por 30 minutos, uso único):"
    ),
    "reset.button": "Redefinir senha",
    "reset.paste_intro": "Ou cole este link no seu navegador:",
    "reset.ignore": (
        "Não foi você? Pode ignorar este e-mail com tranquilidade — sua senha "
        "continua a mesma."
    ),
    "layout.footer": (
        "Você está recebendo este e-mail porque uma conta do WordWise foi criada "
        "com este endereço."
    ),
}

_TR: dict[str, str] = {
    "welcome.subject": "WordWise'a hoş geldiniz 🎬",
    "welcome.greeting": "Merhaba {username},",
    "welcome.intro": (
        "{app}'a hoş geldiniz — artık İngilizceyi gerçekten izlemek istediğiniz "
        "filmlerle öğreniyorsunuz."
    ),
    "welcome.ways_intro": "Başlamanın üç yolu:",
    "welcome.way_add": "Sevdiğiniz bir filmi ekleyin ve kelimelerini keşfedin",
    "welcome.way_save": (
        "Okurken kelimeleri kaydedin — doğrudan tekrar destenize eklenir"
    ),
    "welcome.way_review": "Serinizi büyütmek için günde bir kısa tekrar yapın",
    "welcome.signoff": "Uygulamada görüşmek üzere,",
    "welcome.team": "WordWise ekibi",
    "reset.subject": "WordWise şifrenizi sıfırlayın",
    "reset.greeting": "Merhaba {username},",
    "reset.intro": (
        "Yeni bir şifre seçmek için aşağıdaki düğmeye dokunun. Bağlantı 30 "
        "dakika geçerlidir ve yalnızca bir kez kullanılabilir."
    ),
    "reset.intro_text": (
        "Aşağıdaki bağlantıyı açarak yeni bir WordWise şifresi seçin "
        "(30 dakika geçerli, tek kullanımlık):"
    ),
    "reset.button": "Şifreyi sıfırla",
    "reset.paste_intro": "Veya bu bağlantıyı tarayıcınıza yapıştırın:",
    "reset.ignore": (
        "Bu isteği siz göndermediyseniz bu e-postayı yok sayabilirsiniz — "
        "şifreniz değişmeden kalır."
    ),
    "layout.footer": (
        "Bu e-postayı, bu adresle bir WordWise hesabı oluşturulduğu için "
        "alıyorsunuz."
    ),
}

_RU: dict[str, str] = {
    "welcome.subject": "Добро пожаловать в WordWise 🎬",
    "welcome.greeting": "Здравствуйте, {username}!",
    "welcome.intro": (
        "Добро пожаловать в {app} — теперь вы учите английский по фильмам, "
        "которые действительно хотите посмотреть."
    ),
    "welcome.ways_intro": "Три способа начать:",
    "welcome.way_add": "Добавьте любимый фильм и изучите его лексику",
    "welcome.way_save": (
        "Сохраняйте слова во время чтения — они сразу попадают в колоду повторения"
    ),
    "welcome.way_review": (
        "Проходите одно короткое повторение в день, чтобы не терять серию"
    ),
    "welcome.signoff": "До встречи в приложении,",
    "welcome.team": "Команда WordWise",
    "reset.subject": "Сброс пароля WordWise",
    "reset.greeting": "Здравствуйте, {username}!",
    "reset.intro": (
        "Нажмите кнопку ниже, чтобы задать новый пароль. Ссылка действует 30 "
        "минут и работает один раз."
    ),
    "reset.intro_text": (
        "Задайте новый пароль WordWise, открыв ссылку ниже "
        "(действует 30 минут, один раз):"
    ),
    "reset.button": "Сбросить пароль",
    "reset.paste_intro": "Или вставьте эту ссылку в браузер:",
    "reset.ignore": (
        "Если запрос отправляли не вы, просто проигнорируйте это письмо — "
        "пароль останется прежним."
    ),
    "layout.footer": (
        "Вы получили это письмо, потому что на этот адрес был создан аккаунт "
        "WordWise."
    ),
}

#: Keyed by the same codes as `utils.ui_languages.UI_LANGUAGE_CODES`.
EMAIL_COPY: dict[str, dict[str, str]] = {
    "en": _EN,
    "es": _ES,
    "pt": _PT,
    "tr": _TR,
    "ru": _RU,
}


def email_copy(language: str | None) -> dict[str, str]:
    """Every copy key for `language`, with English filling any gap.

    `language` is whatever `users.language_preference` holds — including
    ``None`` for an account that predates the field, or a locale we no longer
    ship. Both land on English rather than raising: a welcome email runs inside
    a BackgroundTask, where an exception is an email nobody ever gets.
    """
    code = normalize_ui_language(language) or FALLBACK_UI_LANGUAGE
    if code == FALLBACK_UI_LANGUAGE:
        return dict(_EN)
    return {**_EN, **EMAIL_COPY.get(code, {})}
