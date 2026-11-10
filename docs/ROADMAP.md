# Готовность / Readiness — 0.1.0 preview

## Русский

**Нет, исходное ТЗ пока не реализовано на 100%.** Публичный репозиторий содержит
MVP для проверки и доработки, а не обещание совместимости со всеми моделями.

| Пункт ТЗ | В preview | Что осталось |
| --- | --- | --- |
| Текстовые модели, каталог, баланс и цены | Живой каталог, переключение Custom OpenAI, справочные цены и квота ключа | Баланс кошелька; доступ к ценам без дополнительной CORS/proxy-настройки; проверка групповых тарифов и ₽ |
| Картинки, кнопки, `/clodex-img`, автоиллюстрации | Реализованы; автоиллюстрации включаются отдельно | Проверка с реальными image-провайдерами и их параметрами |
| Видео, `/clodex-video`, Image-to-Video | Задачи, прогресс, сохранение, продолжение без повторного POST | Проверка video/I2V по семействам моделей; отображение бесплатных промо-лимитов |
| TTS / STT | Озвучка кнопкой/командой, распознавание аудиофайла в поле ввода | Запись микрофона, интеграция в штатную вкладку TTS, проверка голосов |
| Function tools | Image/video tools с отдельным подтверждением каждого вызова | Проверка полного диалога с Tool Calling на живой текстовой модели |
| Установка и RU/EN | Git-установка, manifest в корне, локализации, ZIP-упаковка | Приёмка на чистом профиле установленного SillyTavern |
| Сайт CLODEx | Не входит в публикацию расширения | Вкладки `/docs`/лендинга и отдельная раздача файлов на домене |

Ссылка на `manifest.json` не заменяет Git URL в установщике SillyTavern.
У расширения нет автоматически определяемого права на бесплатные видео.
Денежные значения показываются только при наличии подходящих серверных метаданных.
Медиа-ключ хранится в памяти вкладки; после перезагрузки его нужно ввести снова.

### Обязательная приёмка перед stable

- [ ] Чистый профиль SillyTavern 1.19.0+: установка, обновление, загрузка RU/EN.
- [ ] Custom OpenAI: сохранение/выбор секрета, потоковый RP-ответ, переключение модели.
- [ ] Изображение, видео, Image-to-Video, TTS и STT через реальные провайдеры
      с согласия владельца ключа на расходы.
- [ ] Медиа после перезагрузки, группы, свайпы, редактирование, смена чата.
- [ ] Ошибки CORS/401/429, обрыв сети, продолжение видеозадачи без повторного списания за создание.
- [ ] Проверка данных кошелька, тарифов, валюты и промо перед обещанием этих функций.

Автотесты и браузерный стенд используют моки API. Они не заменяют эту приёмку.

## English

**This preview does not implement 100% of the requested specification.**
It includes live model discovery, native Custom OpenAI switching, image/video
actions and commands, opt-in automatic images and function tools, resumable video
tasks, file-based STT, speech playback, and RU/EN UI.

Still pending: installed-SillyTavern acceptance and paid provider tests; actual
wallet balance rather than API-key allowance; metadata without extra CORS/proxy
configuration; promo-video allowance display; microphone recording and native TTS
provider integration; model-specific compatibility validation; CLODEx docs/landing
integration and domain hosting. The tab-only media key must be entered after reload.

Mock checks do not establish provider-wide compatibility. The checklist above and
[contract notes](COMPATIBILITY.md) define the boundary before a stable release.
