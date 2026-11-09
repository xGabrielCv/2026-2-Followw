"""Provas de autoria aplicadas também no banco; leituras públicas continuam públicas."""

from sqlalchemy import Connection, text

ADMIN = "current_setting('app.scope', true) = 'admin'"
WRITE = "current_setting('app.scope', true) = 'community_write'"
MIGRATE = "current_setting('app.scope', true) = 'community_migrate'"


def own(column: str) -> str:
    return f"({column} = current_setting('app.author_key', true) OR {column} = current_setting('app.legacy_author_key', true))"


def operation(name: str) -> str:
    return f"({WRITE} AND current_setting('app.community_operation', true) = '{name}')"


def policies() -> list[tuple[str, str, str | None, str | None]]:
    result = []
    for table, column, creation in [
        ("forum_posts", "author_key", "forum_post"),
        ("forum_replies", "author_key", "reply_post"),
        ("materials", "uploader_key", "materials_post"),
        ("tutorials", "author_key", "tutorials_post"),
    ]:
        belongs = own(column)
        visible = (
            "true"
            if table != "tutorials"
            else f"status = 'approved' OR {ADMIN} OR {belongs}"
        )
        check = f"({operation(creation)} AND {column} = current_setting('app.author_key', true))"
        if table == "materials":
            check += " AND subject_code = current_setting('app.material_subject', true)"
        if table == "forum_replies":
            check += " AND post_id::text = current_setting('app.forum_post', true)"
        result += [
            (table, "SELECT", f"{ADMIN} OR {visible}", None),
            (table, "INSERT", None, f"{ADMIN} OR ({check})"),
        ]
        update = f"{ADMIN} OR ({MIGRATE} AND {belongs})"
        if table == "forum_posts":
            update += f" OR ({operation('forum_patch')} AND {belongs} AND id::text = current_setting('app.forum_post', true))"
        result.append((table, "UPDATE", update, f"{ADMIN} OR {belongs}"))
        remove = f"{ADMIN} OR ({operation('reply_delete' if table == 'forum_replies' else table.removesuffix('s') + '_delete')} AND {belongs})"
        if table == "forum_posts":
            remove = f"{ADMIN} OR ({operation('forum_delete')} AND {belongs} AND id::text = current_setting('app.forum_post', true))"
        elif table == "forum_replies":
            remove = f"{ADMIN} OR ({operation('reply_delete')} AND {belongs} AND post_id::text = current_setting('app.forum_post', true))"
        elif table == "materials":
            remove = f"{ADMIN} OR ({operation('materials_delete')} AND {belongs} AND subject_code = current_setting('app.material_subject', true) AND id::text = current_setting('app.material_id', true)) OR ({operation('materials_post')} AND semester < current_setting('app.oldest_semester', true))"
        result.append((table, "DELETE", remove, None))
    review_owner = "token_hash = current_setting('app.review_hash', true)"
    result += [
        ("professor_reviews", "SELECT", "true", None),
        (
            "professor_reviews",
            "INSERT",
            None,
            f"{ADMIN} OR ({operation('reviews_post')} AND {review_owner})",
        ),
        (
            "professor_reviews",
            "UPDATE",
            f"{ADMIN} OR ({operation('reviews_put')} AND {review_owner} AND id::text = current_setting('app.review_id', true))",
            f"{ADMIN} OR {review_owner}",
        ),
        (
            "professor_reviews",
            "DELETE",
            f"{ADMIN} OR ({operation('reviews_delete')} AND {review_owner} AND id::text = current_setting('app.review_id', true))",
            None,
        ),
    ]
    classroom = "EXISTS (SELECT 1 FROM classrooms c WHERE c.id = classroom_groups.classroom_id AND c.subject_code = current_setting('app.group_subject', true) AND c.semester = current_setting('app.group_semester', true) AND c.number = current_setting('app.group_number', true))"
    group_write = f"{ADMIN} OR ({operation('groups_put')} AND {classroom})"
    result += [
        ("classroom_groups", "SELECT", "true", None),
        ("classroom_groups", "INSERT", None, group_write),
        ("classroom_groups", "UPDATE", group_write, group_write),
        ("classroom_groups", "DELETE", group_write, None),
    ]
    report = "current_setting('app.scope', true) = 'report_submit' AND target_id::text = current_setting('app.report_target', true)"
    result += [
        ("reports", "SELECT", f"{ADMIN} OR ({report})", None),
        ("reports", "INSERT", None, f"{ADMIN} OR ({report} AND status = 'pending')"),
        ("reports", "UPDATE", ADMIN, ADMIN),
        ("reports", "DELETE", ADMIN, None),
    ]
    shares = "sharer_key = ANY(string_to_array(current_setting('app.share_keys', true), ','))"
    share_write = f"{ADMIN} OR (current_setting('app.scope', true) IN ('statistics_share', 'community_migrate') AND {shares})"
    result += [
        ("shared_statistics", "SELECT", "true", None),
        ("shared_statistics", "INSERT", None, share_write),
        ("shared_statistics", "UPDATE", share_write, share_write),
        ("shared_statistics", "DELETE", share_write, None),
        ("active_users", "SELECT", ADMIN, None),
        (
            "active_users",
            "INSERT",
            None,
            "current_setting('app.scope', true) = 'usage_record'",
        ),
        ("active_users", "DELETE", ADMIN, None),
    ]
    # Somente a rota de demonstração, bloqueada em produção, recebe este escopo.
    demo = "current_setting('app.scope', true) = 'demo'"
    markers = {
        "forum_posts": "author_key = 'demo'",
        "forum_replies": "author_key IN ('demo', 'demo-0', 'demo-1', 'demo-2')",
        "materials": "uploader_key = 'demo'",
        "tutorials": "author_key = 'demo'",
        "professor_reviews": "token_hash = 'demo'",
        "shared_statistics": "sharer_key = 'demo'",
        "classroom_groups": "position BETWEEN 0 AND 2",
        "reports": "target_type = 'review' AND EXISTS (SELECT 1 FROM professor_reviews r WHERE r.id = reports.target_id AND r.token_hash = 'demo')",
    }
    kinds = {
        "forum_posts": "post",
        "forum_replies": "reply",
        "materials": "material",
        "tutorials": "tutorial",
        "professor_reviews": "review",
        "classroom_groups": "group",
        "reports": "report",
    }
    for index, (table, command, using, check) in enumerate(result):
        if table not in markers:
            continue
        if command == "UPDATE" and table != "tutorials":
            continue
        allowed = f"({demo} AND {markers[table]})"
        if command == "DELETE" and table in kinds:
            allowed = f"({demo} AND EXISTS (SELECT 1 FROM demo_records d WHERE d.record_id = {table}.id AND d.kind = '{kinds[table]}'))"
        if using is not None:
            using = f"({using}) OR {allowed}"
        if check is not None:
            check = f"({check}) OR {allowed}"
        result[index] = (table, command, using, check)
    return result


def install_functions(connection: Connection, role: str) -> None:
    connection.execute(
        text("""
        CREATE OR REPLACE FUNCTION public.followw_reply_counter() RETURNS trigger
        LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
        BEGIN
          IF TG_OP = 'INSERT' THEN
            UPDATE public.forum_posts
            SET reply_count = reply_count + 1, last_activity_at = COALESCE(NEW.created_at, now())
            WHERE id = NEW.post_id AND reply_count < LEAST(500, GREATEST(1,
              COALESCE(NULLIF(current_setting('app.reply_limit', true), '')::integer, 500)));
            IF NOT FOUND THEN
              RAISE EXCEPTION 'Forum reply limit' USING ERRCODE = '23514', CONSTRAINT = 'forum_reply_limit';
            END IF;
            RETURN NEW;
          ELSE
            UPDATE public.forum_posts SET reply_count = GREATEST(0, reply_count - 1) WHERE id = OLD.post_id;
            RETURN OLD;
          END IF;
        END $$;
    """)
    )
    connection.execute(
        text("REVOKE ALL ON FUNCTION public.followw_reply_counter() FROM PUBLIC")
    )
    for operation, timing in [("insert", "BEFORE INSERT"), ("delete", "AFTER DELETE")]:
        name = f"followw_reply_{operation}"
        connection.execute(text(f"DROP TRIGGER IF EXISTS {name} ON forum_replies"))
        connection.execute(
            text(
                f"CREATE TRIGGER {name} {timing} ON forum_replies FOR EACH ROW EXECUTE FUNCTION public.followw_reply_counter()"
            )
        )
    connection.execute(
        text("""
        CREATE OR REPLACE FUNCTION public.followw_pending_tutorials() RETURNS bigint
        LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
        AS $$ SELECT count(*) FROM public.tutorials WHERE status = 'pending' $$;
    """)
    )
    connection.execute(
        text("REVOKE ALL ON FUNCTION public.followw_pending_tutorials() FROM PUBLIC")
    )
    connection.execute(
        text(f"GRANT EXECUTE ON FUNCTION public.followw_pending_tutorials() TO {role}")
    )
