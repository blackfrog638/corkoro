async function setup(root) {
    const endpoint = new URL("/comments", root.dataset.api);
    const articleId = root.dataset.id;
    const list = root.querySelector("ol");
    const listStatus = root.querySelector("[data-list-status]");
    const more = root.querySelector("[data-more]");
    const form = root.querySelector("form");
    let after = 0;
    async function load() {
        more.disabled = true;
        try {
            const url = new URL(endpoint);
            url.search = new URLSearchParams({
                articleId,
                after: String(after),
                limit: "20",
            }).toString();
            const res = await fetch(url, { credentials: "omit", redirect: "error" });
            if (res.status === 404) {
                root.hidden = true;
                return;
            }
            if (!res.ok)
                throw new Error();
            const { comments } = await res.json();
            if (!Array.isArray(comments))
                throw new Error();
            for (const item of comments) {
                if (item.articleId !== articleId ||
                    !Number.isSafeInteger(item.id) ||
                    item.id <= after ||
                    typeof item.displayName !== "string" ||
                    typeof item.body !== "string")
                    throw new Error();
                const li = document.createElement("li"), name = document.createElement("strong"), body = document.createElement("p");
                name.textContent = item.displayName;
                body.textContent = item.body;
                li.append(name, body);
                list.append(li);
                after = item.id;
            }
            listStatus.textContent = after ? "" : "还没有公开评论。";
            more.hidden = comments.length < 20;
            more.textContent = "加载更多";
            form.hidden = false;
        }
        catch {
            listStatus.textContent = "暂时无法加载评论。";
            more.hidden = false;
            more.textContent = "重新加载";
        }
        finally {
            more.disabled = false;
        }
    }
    more.addEventListener("click", load);
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const button = form.querySelector("button"), status = form.querySelector("p");
        if (button.disabled)
            return;
        button.disabled = true;
        const data = new FormData(form);
        status.textContent = "正在提交…";
        try {
            const res = await fetch(endpoint, {
                method: "POST",
                credentials: "omit",
                redirect: "error",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    articleId,
                    displayName: data.get("displayName"),
                    body: data.get("body"),
                }),
            });
            if (res.status === 202) {
                form.reset();
                status.textContent = "已提交，审核通过后会显示在这里。";
            }
            else if (res.status === 429)
                status.textContent = "提交过于频繁，请稍后再试。";
            else if (res.status === 400)
                status.textContent = "请检查显示名和留言内容。";
            else
                throw new Error();
        }
        catch {
            status.textContent = "无法确认提交结果，你的留言已保留。";
        }
        finally {
            button.disabled = false;
        }
    });
    await load();
}
const root = document.querySelector("#comments");
if (root)
    void setup(root);
export {};
//# sourceMappingURL=comment-client.js.map