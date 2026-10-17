import java.io.*;
import java.lang.reflect.*;

public class CFJudge {
    public static void main(String[] args) throws Exception {
        if (args.length > 0 && args[0].equals("compile")) {
            PrintWriter w = new PrintWriter(new OutputStreamWriter(
                new FileOutputStream("/files/__diag"), "UTF-8"));
            String[] j = new String[args.length - 1];
            System.arraycopy(args, 1, j, 0, j.length);
            int rc = com.sun.tools.javac.Main.compile(j, w);
            w.flush(); w.close();
            System.exit(rc);
        }
        // run <ClassName> <stdinPath> <timeLimitMs>
        final String cls = args[1];
        System.setIn(new FileInputStream(args[2]));
        final PrintStream out = new PrintStream(new BufferedOutputStream(
            new FileOutputStream("/files/__out"), 1 << 16), false, "UTF-8");
        final PrintStream err = new PrintStream(new FileOutputStream("/files/__err"), true, "UTF-8");
        System.setOut(out); System.setErr(err);
        Runtime.getRuntime().addShutdownHook(new Thread() {
            public void run() { out.flush(); err.flush(); }
        });
        long limit = 10000;
        try { limit = Long.parseLong(args[3]); } catch (Exception ignored) {}
        final long lim = limit + 500;
        Thread watchdog = new Thread() {
            public void run() {
                try { Thread.sleep(lim); } catch (InterruptedException e) { return; }
                out.flush(); err.flush();
                Runtime.getRuntime().halt(124);
            }
        };
        watchdog.setDaemon(true);
        watchdog.start();
        int code = 0;
        try {
            Method m = Class.forName(cls).getMethod("main", String[].class);
            m.invoke(null, (Object) new String[0]);
        } catch (InvocationTargetException e) {
            (e.getCause() == null ? e : e.getCause()).printStackTrace(err);
            code = 1;
        } catch (Throwable t) {
            t.printStackTrace(err);
            code = 1;
        }
        out.flush(); err.flush();
        System.exit(code);
    }
}
