use std::env;
use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};

use herdr_compat::api::schema::{LayoutNode, Method};

fn resolve(home: &Path, state: &Path) -> io::Result<PathBuf> {
    let settings = state.join("terminal-startup.json");
    let value = match fs::symlink_metadata(&settings) {
        Ok(info) => {
            if !info.is_file() || info.len() > 4096 {
                return Err(io::Error::other("Invalid terminal startup settings"));
            }
            let data: serde_json::Value = serde_json::from_slice(&fs::read(settings)?)?;
            data.get("startup_path")
                .and_then(|value| value.as_str())
                .ok_or_else(|| io::Error::other("Invalid terminal startup path"))?
                .to_string()
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => "~/work".to_string(),
        Err(error) => return Err(error),
    };
    if value.is_empty() || value.len() > 1024 || value.chars().any(char::is_control) {
        return Err(io::Error::other("Invalid terminal startup path"));
    }
    let path = if value == "~" {
        home.to_path_buf()
    } else if let Some(relative) = value.strip_prefix("~/") {
        home.join(relative)
    } else {
        PathBuf::from(&value)
    };
    if !path.is_absolute() || path.components().any(|part| part == Component::ParentDir) {
        return Err(io::Error::other(
            "Terminal startup path must be an absolute directory or begin with ~/",
        ));
    }
    if value == "~/work" {
        fs::create_dir_all(&path)?;
    }
    if !path.is_dir() {
        return Err(io::Error::other(
            "Terminal startup directory no longer exists; update it in Settings → Terminal",
        ));
    }
    Ok(path)
}

fn layout_directory(node: &mut LayoutNode, directory: &str) {
    match node {
        LayoutNode::Pane { pane } => {
            if pane.pane_id.is_none() && pane.cwd.is_none() {
                pane.cwd = Some(directory.to_string());
            }
        }
        LayoutNode::Split { first, second, .. } => {
            layout_directory(first, directory);
            layout_directory(second, directory);
        }
    }
}

fn set_directory(method: &mut Method, directory: &str) {
    match method {
        Method::WorkspaceCreate(params) => params.cwd = Some(directory.to_string()),
        Method::TabCreate(params) => params.cwd = Some(directory.to_string()),
        Method::PaneSplit(params) => params.cwd = Some(directory.to_string()),
        Method::LayoutApply(params) => layout_directory(&mut params.root, directory),
        _ => {}
    }
}

pub fn apply(method: &mut Method) -> io::Result<()> {
    if !matches!(
        method,
        Method::WorkspaceCreate(_)
            | Method::TabCreate(_)
            | Method::PaneSplit(_)
            | Method::LayoutApply(_)
    ) {
        return Ok(());
    }
    let home = env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| io::Error::other("HOME is required for terminal startup paths"))?;
    let state = env::var_os("PASSEL_STATE_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join("containers/herdr-web"));
    let directory = resolve(&home, &state)?;
    set_directory(method, &directory.to_string_lossy());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use herdr_compat::api::schema::{LayoutPane, SplitDirection};

    #[test]
    fn default_work_and_saved_paths_are_resolved_for_the_server() {
        let home = env::temp_dir().join(format!(
            "passel-startup-{}-{}",
            std::process::id(),
            crate::store_util::now_ms_string()
        ));
        fs::create_dir_all(&home).unwrap();
        let state = home.join("state");
        assert_eq!(resolve(&home, &state).unwrap(), home.join("work"));
        fs::create_dir_all(&state).unwrap();
        let custom = home.join("custom directory");
        fs::create_dir(&custom).unwrap();
        fs::write(
            state.join("terminal-startup.json"),
            r#"{"startup_path":"~/custom directory"}"#,
        )
        .unwrap();
        assert_eq!(resolve(&home, &state).unwrap(), custom);
        for invalid in ["relative", "~/../outside", "~/missing"] {
            fs::write(
                state.join("terminal-startup.json"),
                serde_json::json!({"startup_path":invalid}).to_string(),
            )
            .unwrap();
            assert!(resolve(&home, &state).is_err());
        }
        fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn only_new_layout_leaves_receive_the_default_directory() {
        let existing = LayoutNode::Pane {
            pane: LayoutPane {
                pane_id: Some("old".into()),
                ..Default::default()
            },
        };
        let configured = LayoutNode::Pane {
            pane: LayoutPane {
                cwd: Some("/explicit".into()),
                ..Default::default()
            },
        };
        for keep in [existing, configured] {
            let mut root = LayoutNode::Split {
                direction: SplitDirection::Right,
                ratio: 0.5,
                first: Box::new(keep.clone()),
                second: Box::new(LayoutNode::Pane {
                    pane: LayoutPane::default(),
                }),
            };
            layout_directory(&mut root, "/work");
            let LayoutNode::Split { first, second, .. } = root else {
                panic!()
            };
            assert_eq!(*first, keep);
            let LayoutNode::Pane { pane } = *second else {
                panic!()
            };
            assert_eq!(pane.cwd.as_deref(), Some("/work"));
        }
    }

    #[test]
    fn new_spaces_tabs_and_splits_receive_the_directory() {
        for (method, params) in [
            ("workspace.create", serde_json::json!({"focus":true})),
            ("tab.create", serde_json::json!({"focus":true})),
            (
                "pane.split",
                serde_json::json!({"direction":"right","focus":true}),
            ),
        ] {
            let mut value: Method =
                serde_json::from_value(serde_json::json!({"method":method,"params":params}))
                    .unwrap();
            set_directory(&mut value, "/work");
            assert_eq!(
                serde_json::to_value(value).unwrap()["params"]["cwd"],
                "/work"
            );
        }
    }
}
