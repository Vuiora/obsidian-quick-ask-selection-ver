# Selection exploration

Select text in a Markdown note and click **Ask for AI**. The popup sends the complete source note and selection to your configured model. Answers are rendered as Markdown and stream when the provider supports streaming.

Select text in any answer and click **继续解释** (Continue explaining), type a follow-up, or choose a model-generated exploration question. Each new answer is appended while existing answers remain visible. Columns wrap into additional rows when space runs out. The model generates questions from each answer; if the response contains no valid questions, the plugin requests them separately and offers a retry on failure.

Drag the header to move the popup and its bottom-right corner to resize it. Click **保存** (Save) to create a Markdown snapshot in the source note’s folder without overwriting an existing file. A snapshot taken during generation contains only the text available at that moment. Closing the popup cancels running requests.

The selection, complete source note, follow-up questions and relevant parent answers are sent to your configured model provider. Model and search costs depend on that provider.

This fork is based on Quick Ask 1.0.7 and contains downstream customizations. The upstream `release:check` provenance guard rejects these changes; do not present this branch as an unchanged upstream synchronization.
