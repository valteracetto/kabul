// Dicionário inglês inteiro (um pedaço de JS à parte: só o idioma em uso é baixado).
import app from "./app.json";
import chat from "./chat.json";
import code from "./code.json";
import common from "./common.json";
import errors from "./errors.json";
import mobile from "./mobile.json";
import settings from "./settings.json";
import usage from "./usage.json";

export default { ...common, ...app, ...chat, ...code, ...settings, ...usage, ...mobile, ...errors };
