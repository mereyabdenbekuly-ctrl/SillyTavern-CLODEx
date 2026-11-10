# Готовность / Readiness — 0.3.0 public preview

## Что реализовано

| Пункт ТЗ | Результат | Граница проверки |
| --- | --- | --- |
| Текст и RP | Живой каталог, цены/кэш, Custom OpenAI, отдельный кошелёк USD/RUB и лимит ключа | Native настройки и Secrets проверены; реальные потоковые ответы моделей не проверялись |
| Изображения | Кнопки, `/clodex-img`, карточка/контекст, опциональные автоиллюстрации | Mock API, реальные файлы и media renderer SillyTavern |
| Видео и I2V | Кнопки, `/clodex-video`, прогресс, плеер, `/clodex-resume` без повторного POST | Реальная декодировка MP4; внешние провайдеры имитированы |
| TTS и STT | Кнопка/команда, штатный TTS-провайдер CLODEx, голоса, микрофон/аудиофайл | Voice map, `/speak`, F5, fake-device MediaRecorder и ручная отправка STT проверены |
| Tool Calling | `clodex_generate_image`, `clodex_generate_video`, явное согласие | Оба инструмента вызваны через настоящий ToolManager; решение живой LLM не проверялось |
| Установка/ключ | Git URL, ZIP, RU/EN, сохранение ключа с предупреждением | SillyTavern 1.19.0; ключ не появляется в чате и восстанавливается после F5 |
| Сайт и backend | Узкий CORS/кошелёк уже выпущены; docs, landing и mirror входят в отдельный backend-релиз | Публикация репозитория расширения сама по себе не развёртывает сайт |

### Отличие от исходного ТЗ: бесплатные промо-видео

Действующий backend оплачивает видео **только из платного кошелька**.
Промобаланс, Credits и подписки не дают бесплатных попыток. Расширение показывает
серверную политику и платный остаток, но не вводит новые льготы. Для бесплатных
видео нужны отдельно согласованные правила продукта и серверного биллинга;
клиентский счётчик не может заменить их. Поэтому «100% исходного ТЗ» не заявляется.

### До stable / платной сертификации

- [ ] Потоковый RP-ответ и полный диалог Tool Calling на живой текстовой модели.
- [ ] По одной image/video/I2V/TTS/STT генерации для заявляемых семейств моделей
      с согласованными ключом и бюджетом.
- [ ] Провайдерские ограничения размеров, длительностей, голосов и ошибки оплаты.
- [ ] Ручная приёмка сложных групповых чатов и пользовательских пресетов.

Юнит-тесты покрывают смену чата/свайпа, редактирование, отказ сети, CORS,
401/429, неопределённый POST и продолжение задачи без повторного создания.
Установленный хост использует настоящие API хранения SillyTavern, но **моки CLODEx**.

## English

0.3.0 implements text integration, wallet/catalog, images, video/I2V, resumable jobs,
native TTS, microphone/file STT, tools and RU/EN. Installed-host acceptance exercises
real SillyTavern storage, media, Secrets, voice maps and ToolManager with mocked
upstream APIs. Live paid-provider acceptance remains a separate, owner-approved gate.

Free promotional video is not a current backend entitlement. Video is paid-wallet-only;
the client reports that policy instead of inventing free attempts. A stable release
must not claim provider-wide certification or full original-spec completion yet.
