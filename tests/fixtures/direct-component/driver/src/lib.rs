wit_bindgen::generate!({
    inline: r#"
        package porffor:internal@0.1.0;
        interface api {
            main: func();
        }
        world driver {
            import api;
        }
    "#,
});

struct Command;
impl wasip3::exports::cli::run::Guest for Command {
    async fn run() -> Result<(), ()> {
        porffor::internal::api::main();
        Ok(())
    }
}

wasip3::cli::command::export!(Command);
